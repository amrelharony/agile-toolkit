/**
 * Canonical kudos validator + v1→v2 upgrader.
 *
 * The wire (`use-kudos-room.ts`), the persist boundary (`upsertKudos` in
 * workspace-store), the future cloud-hydrate path (`/api/kudos`) and JSON
 * import all share THIS one entrypoint. Prior to Phase 0 the same shape
 * check lived in three places drifting independently — that's how
 * boundary-skew bugs hide.
 *
 * Discriminated result over a boolean guard: callers need to know WHY a
 * payload was rejected (route handlers surface 400 with the error code,
 * tests assert against it, the realtime layer logs it).
 *
 * `upgraded: true` signals that the input lacked v2 fields — workspace-
 * store uses that flag to heal the persist slot so v1 rows mature to v2
 * the next time they round-trip through `upsertKudos`.
 */

import type {
  Kudos,
  KudosBuiltInTheme,
  KudosCustomTheme,
  KudosReaction,
  KudosSentiment,
  KudosTheme,
} from "@/lib/stores/workspace-types";
import { PRINT_CARD_THEME_IDS, isCardEpisode } from "./print-cards";

export type KudosParseResult =
  | { ok: true; kudos: Kudos; upgraded: boolean }
  | { ok: false; error: string };

/** The printed cards' themes, then the seven original ones, which saved cards still carry. */
const BUILT_IN_THEMES: ReadonlySet<KudosBuiltInTheme> = new Set<KudosBuiltInTheme>([
  ...PRINT_CARD_THEME_IDS,
  "awesome",
  "thank-you",
  "great-job",
  "congratulations",
  "very-happy",
  "you-rock",
  "well-done",
]);

const SHORT_TEXT_MAX = 80;
/** The longest message a kudos may carry, in characters. */
export const MESSAGE_CHAR_MAX = 2000;
const ID_MAX = 64;
const SENT_AT_MAX = 64;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

const CUSTOM_THEME_ID_RE = /^[a-z0-9-]{1,32}$/;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const REACTION_EMOJI_MAX = 8;
const REACTIONS_MAX = 24;
const SENTIMENT_TONE_MAX = 8;
const SENTIMENT_TONE_LEN_MAX = 32;
const IDENTITY_ID_MAX = 128;

function countCodepoints(s: string): number {
  // String.length counts UTF-16 code units, so a "4 codepoints" cap that
  // looks right on .length lets a 2-emoji ZWJ sequence through twice. The
  // spread / Array.from path normalises to Unicode code points.
  return Array.from(s).length;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function parseCustomTheme(raw: unknown): KudosCustomTheme | null {
  if (!isPlainObject(raw)) return null;
  const id = raw.id;
  const title = raw.title;
  const emoji = raw.emoji;
  const hex = raw.hex;
  if (typeof id !== "string" || !CUSTOM_THEME_ID_RE.test(id)) return null;
  if (typeof title !== "string" || title.length === 0 || title.length > SHORT_TEXT_MAX) return null;
  if (typeof emoji !== "string" || emoji.length === 0 || countCodepoints(emoji) > 4) return null;
  if (typeof hex !== "string" || !HEX_COLOR_RE.test(hex)) return null;
  return { id, title, emoji, hex };
}

function parseTheme(raw: unknown): KudosTheme | null {
  if (typeof raw === "string") {
    return BUILT_IN_THEMES.has(raw as KudosBuiltInTheme) ? (raw as KudosBuiltInTheme) : null;
  }
  return parseCustomTheme(raw);
}

function parseSentiment(raw: unknown): KudosSentiment | null {
  if (!isPlainObject(raw)) return null;
  const label = raw.label;
  const confidence = raw.confidence;
  const tone = raw.tone;
  if (label !== "positive" && label !== "neutral" && label !== "backhanded") return null;
  if (
    typeof confidence !== "number" ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1
  )
    return null;
  if (!Array.isArray(tone) || tone.length > SENTIMENT_TONE_MAX) return null;
  const tones: string[] = [];
  for (const t of tone) {
    if (typeof t !== "string" || t.length === 0 || t.length > SENTIMENT_TONE_LEN_MAX) return null;
    tones.push(t);
  }
  return { label, confidence, tone: tones };
}

function parseReactions(raw: unknown): KudosReaction[] | null {
  if (!Array.isArray(raw) || raw.length > REACTIONS_MAX) return null;
  const out: KudosReaction[] = [];
  for (const r of raw) {
    if (!isPlainObject(r)) return null;
    const emoji = r.emoji;
    const byProfileId = r.byProfileId;
    const at = r.at;
    if (
      typeof emoji !== "string" ||
      emoji.length === 0 ||
      countCodepoints(emoji) > REACTION_EMOJI_MAX
    )
      return null;
    if (typeof byProfileId !== "string" || byProfileId.length === 0 || byProfileId.length > ID_MAX)
      return null;
    if (typeof at !== "string" || at.length === 0 || at.length > SENT_AT_MAX) return null;
    const ms = Date.parse(at);
    if (!Number.isFinite(ms)) return null;
    out.push({ emoji, byProfileId, at });
  }
  return out;
}

export function parseKudos(raw: unknown): KudosParseResult {
  if (!isPlainObject(raw)) return { ok: false, error: "not_an_object" };

  const id = raw.id;
  if (typeof id !== "string" || id.length === 0 || id.length > ID_MAX) {
    return { ok: false, error: "invalid_id" };
  }

  const theme = parseTheme(raw.theme);
  if (theme === null) return { ok: false, error: "invalid_theme" };
  // A custom-theme object is a v2-only shape — pre-redesign clients
  // can't render it. Pre-flag the version flip here so the trailing
  // version decision sees the correct sawV2Field state.
  const themeIsCustom = typeof theme !== "string";

  const toName = raw.toName;
  if (typeof toName !== "string" || toName.length === 0 || toName.length > SHORT_TEXT_MAX) {
    return { ok: false, error: "invalid_to_name" };
  }

  const fromName = raw.fromName;
  if (typeof fromName !== "string" || fromName.length === 0 || fromName.length > SHORT_TEXT_MAX) {
    return { ok: false, error: "invalid_from_name" };
  }

  const message = raw.message;
  if (typeof message !== "string" || message.length === 0 || message.length > MESSAGE_CHAR_MAX) {
    return { ok: false, error: "invalid_message" };
  }

  const sentAt = raw.sentAt;
  if (typeof sentAt !== "string" || sentAt.length === 0 || sentAt.length > SENT_AT_MAX) {
    return { ok: false, error: "invalid_sent_at" };
  }
  const sentAtMs = Date.parse(sentAt);
  if (!Number.isFinite(sentAtMs)) return { ok: false, error: "invalid_sent_at" };
  // Reject far-future timestamps (>5 min ahead) so a peer can't
  // backdate-bomb the wall. Past timestamps are fine — backfill and
  // out-of-order delivery both look like past sends.
  if (sentAtMs > Date.now() + CLOCK_SKEW_MS) return { ok: false, error: "sent_at_in_future" };

  // Optional ids: reject empty strings too. The DB uuid cast would 500
  // on them and a stored "" carries no semantic meaning. Required
  // fields (id, message) already reject zero-length.
  if (raw.toProfileId !== undefined) {
    if (
      typeof raw.toProfileId !== "string" ||
      raw.toProfileId.length === 0 ||
      raw.toProfileId.length > ID_MAX
    ) {
      return { ok: false, error: "invalid_to_profile_id" };
    }
  }
  if (raw.fromProfileId !== undefined) {
    if (
      typeof raw.fromProfileId !== "string" ||
      raw.fromProfileId.length === 0 ||
      raw.fromProfileId.length > ID_MAX
    ) {
      return { ok: false, error: "invalid_from_profile_id" };
    }
  }
  if (raw.teamName !== undefined) {
    if (
      typeof raw.teamName !== "string" ||
      raw.teamName.length === 0 ||
      raw.teamName.length > SHORT_TEXT_MAX
    ) {
      return { ok: false, error: "invalid_team_name" };
    }
  }

  // v2-only fields. The presence of ANY one of them upgrades the row to
  // v2 even if the input lacked an explicit `version`. The absence of all
  // of them keeps the row at v1 (legacy).
  let sawV2Field = themeIsCustom;

  let senderIdentityId: string | undefined;
  if (raw.senderIdentityId !== undefined) {
    if (typeof raw.senderIdentityId !== "string" || raw.senderIdentityId.length > IDENTITY_ID_MAX) {
      return { ok: false, error: "invalid_sender_identity_id" };
    }
    senderIdentityId = raw.senderIdentityId;
    sawV2Field = true;
  }

  let recipientIdentityId: string | undefined;
  if (raw.recipientIdentityId !== undefined) {
    if (
      typeof raw.recipientIdentityId !== "string" ||
      raw.recipientIdentityId.length > IDENTITY_ID_MAX
    ) {
      return { ok: false, error: "invalid_recipient_identity_id" };
    }
    recipientIdentityId = raw.recipientIdentityId;
    sawV2Field = true;
  }

  let sentiment: KudosSentiment | undefined;
  if (raw.sentiment !== undefined) {
    const parsed = parseSentiment(raw.sentiment);
    if (!parsed) return { ok: false, error: "invalid_sentiment" };
    sentiment = parsed;
    sawV2Field = true;
  }

  let llmDedupGroup: string | undefined;
  if (raw.llmDedupGroup !== undefined) {
    if (typeof raw.llmDedupGroup !== "string" || raw.llmDedupGroup.length > ID_MAX) {
      return { ok: false, error: "invalid_llm_dedup_group" };
    }
    llmDedupGroup = raw.llmDedupGroup;
    sawV2Field = true;
  }

  let fairnessScoreAtSend: number | undefined;
  if (raw.fairnessScoreAtSend !== undefined) {
    if (
      typeof raw.fairnessScoreAtSend !== "number" ||
      !Number.isFinite(raw.fairnessScoreAtSend) ||
      raw.fairnessScoreAtSend < 0 ||
      raw.fairnessScoreAtSend > 1
    ) {
      return { ok: false, error: "invalid_fairness_score" };
    }
    fairnessScoreAtSend = raw.fairnessScoreAtSend;
    sawV2Field = true;
  }

  let reactions: KudosReaction[] | undefined;
  if (raw.reactions !== undefined) {
    const parsed = parseReactions(raw.reactions);
    if (!parsed) return { ok: false, error: "invalid_reactions" };
    reactions = parsed;
    sawV2Field = true;
  }

  let replyTo: string | undefined;
  if (raw.replyTo !== undefined) {
    if (
      typeof raw.replyTo !== "string" ||
      raw.replyTo.length === 0 ||
      raw.replyTo.length > ID_MAX
    ) {
      return { ok: false, error: "invalid_reply_to" };
    }
    replyTo = raw.replyTo;
    sawV2Field = true;
  }

  // Phase 6: the roster member the kudos is for (TeamMember.id), when the
  // sender picked them from the roster. Bounded like toProfileId; without
  // this copy every write through upsertKudos or import would drop it.
  let toMemberId: string | undefined;
  if (raw.toMemberId !== undefined) {
    if (
      typeof raw.toMemberId !== "string" ||
      raw.toMemberId.length === 0 ||
      raw.toMemberId.length > ID_MAX
    ) {
      return { ok: false, error: "invalid_to_member_id" };
    }
    toMemberId = raw.toMemberId;
    sawV2Field = true;
  }

  // The book episode whose printed card this was written from. Only the
  // number travels; the wording is read from the print campaign's data file.
  let episode: number | undefined;
  if (raw.episode !== undefined && raw.episode !== null) {
    if (!isCardEpisode(raw.episode)) return { ok: false, error: "invalid_episode" };
    episode = raw.episode;
    sawV2Field = true;
  }

  const inputVersion = raw.version;
  let version: 1 | 2;
  if (inputVersion === 2 || sawV2Field) {
    version = 2;
  } else if (inputVersion === 1 || inputVersion === undefined) {
    version = 1;
  } else {
    return { ok: false, error: "invalid_version" };
  }

  const kudos: Kudos = {
    id,
    version,
    theme,
    toName,
    fromName,
    message,
    sentAt,
  };
  if (raw.toProfileId !== undefined) kudos.toProfileId = raw.toProfileId as string;
  if (toMemberId !== undefined) kudos.toMemberId = toMemberId;
  if (raw.fromProfileId !== undefined) kudos.fromProfileId = raw.fromProfileId as string;
  if (raw.teamName !== undefined) kudos.teamName = raw.teamName as string;
  if (senderIdentityId !== undefined) kudos.senderIdentityId = senderIdentityId;
  if (recipientIdentityId !== undefined) kudos.recipientIdentityId = recipientIdentityId;
  if (sentiment !== undefined) kudos.sentiment = sentiment;
  if (llmDedupGroup !== undefined) kudos.llmDedupGroup = llmDedupGroup;
  if (fairnessScoreAtSend !== undefined) kudos.fairnessScoreAtSend = fairnessScoreAtSend;
  if (reactions !== undefined) kudos.reactions = reactions;
  if (replyTo !== undefined) kudos.replyTo = replyTo;
  if (episode !== undefined) kudos.episode = episode;

  // A row was "upgraded" if the input didn't already carry a v2 version
  // marker but we either stamped one from v2 field presence, or stamped
  // v1 onto a row with no version at all. Workspace-store uses this to
  // decide whether to write the parsed shape back to the persist slot.
  const upgraded = inputVersion === undefined;

  return { ok: true, kudos, upgraded };
}

/**
 * Convenience boolean guard. Existing call sites that just need a yes/no
 * answer (the realtime hook's inbound dedup) can keep their semantics.
 * Prefer parseKudos in new code so error reasons aren't lost.
 */
export function isValidKudos(raw: unknown): raw is Kudos {
  return parseKudos(raw).ok;
}
