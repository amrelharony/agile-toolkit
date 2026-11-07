/**
 * Kudos Wall — tool-local actions.
 *
 * Category: Flow & Outcomes (squad S6) — squad-interactive recognition cards.
 * Tool:     A recognition wall. Live updates fan out over a realtime room;
 *           the owner's wall persists in the workspace store. As of this
 *           change kudos is ALSO a registered synced collection
 *           ("workspace:kudos"), so MCP reads/writes round-trip + cloud-sync.
 *
 * Agent surface: tool.kudos.*
 *   1. list_state         — the wall (newest first) + count.
 *   2. recognition_stats  — kudos received per person, the roster members
 *                           with none, fairness hints from the roster, and the
 *                           per-recipient / per-sender / theme / sentiment
 *                           tallies, over a sprint or a date range.
 *   3. post_kudos         — add a kudo on a printed card (validated through
 *                           canonical parseKudos).
 *   4. remove_kudos       — delete a kudo by id.
 *
 * recognition_stats reads kudos by the page's rules, through the same pure
 * lib/kudos/recognition (replies and example kudos left out, a roster
 * member matched by toMemberId, else by name). The page itself shows no
 * counts, only who hasn't been thanked: that is rosterWithNone here.
 *
 * post_kudos routes through parseKudos — the SAME validator the realtime wire
 * and the store's upsertKudos use — so an agent can't smuggle a malformed card
 * past a boundary. We deliberately do NOT add the generic
 * workspace.kudos.* CRUD (defineCrudActions) for kudos: generic create would
 * bypass that canonical validation + the v1→v2 upgrade stamp.
 */

import { z } from "zod";
import {
  DEFAULT_PRINT_CARD_THEME,
  isPrintCardThemeId,
  printCardTheme,
  type PrintCardThemeId,
} from "@/lib/kudos/print-cards";
import { CARD_DESIGNS, episodeDesign } from "@/lib/kudos/card-designs";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  serverListEntities,
  serverGetEntity,
  serverUpsertEntity,
  serverDeleteEntity,
} from "../server-store";
import { parseKudos } from "@/lib/kudos/parse";
import {
  fairnessHints,
  isRecognition,
  recognitionReceived,
  sentIn,
  sprintWindow,
  type RecognitionWindow,
} from "@/lib/kudos/recognition";
import { localDay, todayIso } from "@/lib/sprints/series";
import { nameKey } from "@/lib/team/names";
import { isExampleId } from "@/lib/utils/example-id";
import type { Kudos, Sprint, TeamMember } from "@/lib/stores/workspace-types";

const KIND_K = "workspace:kudos";
const KIND_TEAM = "workspace:teamMember";
const KIND_SPRINT = "workspace:sprint";

const ws = () => useWorkspaceStore.getState();

/**
 * The wall as the page shows it. Example kudos (the page's Load example;
 * ids start with "example-") stay on the wall until Clear example, so they
 * are listed, but marked `example: true` and counted apart: recognition_stats,
 * the retro and the room leave them out.
 */
function summarize(kudos: Kudos[]) {
  const sorted = [...kudos].sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  const examples = sorted.filter((k) => isExampleId(k.id)).length;
  return {
    total: sorted.length,
    examples,
    kudos: sorted.map((k) => (isExampleId(k.id) ? { ...k, example: true as const } : k)),
  };
}

/* ── recognition_stats ─────────────────────────────────────────────── */

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const statsParams = z.object({
  from: z.string().regex(ISO_DAY, "YYYY-MM-DD").optional(),
  to: z.string().regex(ISO_DAY, "YYYY-MM-DD").optional(),
  sprintId: z.string().min(1).max(128).optional(),
});
type StatsParams = z.infer<typeof statsParams>;

/** The window the stats cover, as returned: null for all time. */
interface StatsWindow extends RecognitionWindow {
  sprintId?: string;
  sprintName?: string;
}

type WindowPick =
  | { ok: true; window: StatsWindow | null; label: string }
  | { ok: false; error: "unknown_sprint" | "sprint_has_no_dates" | "from_after_to" };

/**
 * A sprint's days (as the page's Sprint window reads them), or `from`..`to`
 * (to defaults to today, from to the first kudos), or all time.
 */
function pickWindow(
  params: StatsParams,
  kudos: readonly Kudos[],
  sprints: readonly Sprint[]
): WindowPick {
  if (params.sprintId) {
    const sprint = sprints.find((s) => s.id === params.sprintId);
    if (!sprint) return { ok: false, error: "unknown_sprint" };
    const w = sprintWindow(sprint);
    if (!w) return { ok: false, error: "sprint_has_no_dates" };
    return {
      ok: true,
      window: { ...w, sprintId: sprint.id, sprintName: sprint.name },
      label: `in ${sprint.name}`,
    };
  }
  if (params.from || params.to) {
    const to = params.to ?? todayIso();
    const first = kudos
      .map((k) => localDay(k.sentAt))
      .filter((d): d is string => Boolean(d))
      .sort()[0];
    const from = params.from ?? (first && first < to ? first : to);
    if (from > to) return { ok: false, error: "from_after_to" };
    return { ok: true, window: { from, to }, label: `from ${from} to ${to}` };
  }
  return { ok: true, window: null, label: "so far" };
}

function computeStats(
  kudos: readonly Kudos[],
  roster: readonly TeamMember[],
  window: StatsWindow | null,
  label: string
) {
  const summary = recognitionReceived(kudos, roster, window);
  // The legacy tallies, over the same kudos: recognition only, in the window.
  const counted = kudos.filter((k) => isRecognition(k) && sentIn(k, window));
  const byRecipient: Record<string, number> = {};
  for (const r of summary.recipients) byRecipient[r.name] = r.count;
  const bySender: Record<string, number> = {};
  const themeCounts: Record<string, number> = {};
  const sentimentCounts: Record<string, number> = {};
  for (const k of counted) {
    bySender[k.fromName] = (bySender[k.fromName] ?? 0) + 1;
    const themeId = typeof k.theme === "string" ? k.theme : k.theme.id;
    themeCounts[themeId] = (themeCounts[themeId] ?? 0) + 1;
    if (k.sentiment)
      sentimentCounts[k.sentiment.label] = (sentimentCounts[k.sentiment.label] ?? 0) + 1;
  }
  return {
    total: summary.total,
    byRecipient,
    bySender,
    themeCounts,
    sentimentCounts,
    topRecipients: summary.recipients.map((r) => ({ name: r.name, count: r.count })),
    received: summary.recipients,
    rosterWithNone: summary.rosterWithNone,
    topShare: summary.topShare,
    enough: summary.enough,
    hints: fairnessHints(summary, roster.length, { windowLabel: label }),
    window,
  };
}

async function statsFor(
  params: StatsParams,
  kudos: readonly Kudos[],
  roster: readonly TeamMember[],
  sprints: () => Promise<readonly Sprint[]> | readonly Sprint[]
) {
  const pick = pickWindow(params, kudos, params.sprintId ? await sprints() : []);
  if (!pick.ok) return { error: pick.error };
  return computeStats(kudos, roster, pick.window, pick.label);
}

/* ── post_kudos ────────────────────────────────────────────────────── */

interface PostParams {
  toName: string;
  message: string;
  fromName?: string;
  theme?: string;
  episode?: number;
  teamName?: string;
  toProfileId?: string;
  toMemberId?: string;
  fromProfileId?: string;
}

type CardPick =
  | { ok: true; theme: PrintCardThemeId; episode?: number }
  | {
      ok: false;
      error: "invalid_theme" | "invalid_episode" | "episode_required" | "theme_episode_mismatch";
      message?: string;
    };

/** "an Ownership card", "a Focus card". */
function aCard(habit: string): string {
  return `${/^[AEIOU]/.test(habit) ? "an" : "a"} ${habit} card`;
}

/** "1, 2, 6, 10, 16, 24 or 25". */
function orList(items: readonly number[]): string {
  return items.length > 1
    ? `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`
    : items.join("");
}

/**
 * The printed card a posted kudos is written on, as the page's picker has
 * it: a habit's cards are its book episodes' cards, so a habit theme needs
 * one of that habit's episodes; an open card ("Thank you!", "Great
 * teamwork!") may name the episode it reminds the sender of; an episode on
 * its own is on its habit; nothing at all is a "Thank you!" card. The
 * tool's original theme ids are for saved cards only, not new ones.
 */
function pickCard(theme: string | undefined, episode: number | undefined): CardPick {
  if (theme !== undefined && !isPrintCardThemeId(theme)) {
    return { ok: false, error: "invalid_theme" };
  }
  const card = episodeDesign(episode);
  if (episode !== undefined && !card) return { ok: false, error: "invalid_episode" };
  const withEpisode = episode !== undefined ? { episode } : {};
  if (theme === undefined) {
    return { ok: true, theme: card?.theme ?? DEFAULT_PRINT_CARD_THEME, ...withEpisode };
  }
  const habit = printCardTheme(theme).habit;
  if (!habit) return { ok: true, theme, ...withEpisode };
  if (!card) {
    const episodes = CARD_DESIGNS.filter((d) => d.theme === theme).map((d) => d.ep ?? 0);
    return {
      ok: false,
      error: "episode_required",
      message: `${aCard(habit).replace(/^a/, "A")} is a book episode's card: pass an episode of ${habit} (${orList(episodes)}), or use open-thank-you or open-teamwork.`,
    };
  }
  if (card.theme !== theme) {
    return {
      ok: false,
      error: "theme_episode_mismatch",
      message: `Episode ${episode} is ${aCard(card.habit)}: leave theme out, or pass theme '${card.theme}'.`,
    };
  }
  return { ok: true, theme, ...withEpisode };
}

/** Assemble the raw kudo for parseKudos (omits empty optionals it would reject). */
function buildKudo(params: PostParams, card: { theme: PrintCardThemeId; episode?: number }) {
  const raw: Record<string, unknown> = {
    id: crypto.randomUUID(),
    theme: card.theme,
    toName: params.toName,
    fromName: params.fromName ?? "AI Assistant",
    message: params.message,
    sentAt: new Date().toISOString(),
  };
  if (card.episode !== undefined) raw.episode = card.episode;
  if (params.teamName) raw.teamName = params.teamName;
  if (params.toProfileId) raw.toProfileId = params.toProfileId;
  if (params.toMemberId) raw.toMemberId = params.toMemberId;
  if (params.fromProfileId) raw.fromProfileId = params.fromProfileId;
  return raw;
}

/** A refused card, as post_kudos returns it. */
function refused(pick: Extract<CardPick, { ok: false }>) {
  return {
    posted: false as const,
    error: pick.error,
    ...(pick.message ? { message: pick.message } : {}),
  };
}

/**
 * A kudos for a roster member names them as the roster does, as the page
 * stamps them: toName must be that member (trimmed, case-insensitive), and
 * it is saved in the roster's spelling. A card reading "Kudos to Sam" that
 * counts for Priya would otherwise slip through.
 */
function withMember(
  params: PostParams,
  member: TeamMember | undefined
): { ok: true; params: PostParams } | { ok: false; error: "unknown_member" | "name_mismatch" } {
  if (!params.toMemberId) return { ok: true, params };
  if (!member) return { ok: false, error: "unknown_member" };
  if (nameKey(params.toName) !== nameKey(member.name)) return { ok: false, error: "name_mismatch" };
  return { ok: true, params: { ...params, toName: member.name.trim() } };
}

// ──────── tool.kudos.list_state ────────
registry.register({
  id: "tool.kudos.list_state",
  toolId: "tool.kudos",
  name: "list_state",
  category: "read",
  description:
    "Read the kudos wall, newest first. Returns {total (every row, examples included), examples (how many are example kudos), kudos: {id, theme, toName, toMemberId?, fromName, message, sentAt, replyTo?, example?, ...}[]}. Replies carry replyTo (the kudos they answer). Example kudos (loaded by the page's Load example, ids starting with 'example-') carry example: true: they stay on the wall until the user presses Clear example, and recognition_stats leaves them out, so don't treat them as real recognition.",
  paramsSchema: z.object({}),
  handler: async () => summarize(ws().kudos ?? []),
  mcpHandler: async (_params, ctx) =>
    summarize(await serverListEntities<Kudos>(ctx.userId, KIND_K)),
});

// ──────── tool.kudos.recognition_stats ────────
registry.register({
  id: "tool.kudos.recognition_stats",
  toolId: "tool.kudos",
  name: "recognition_stats",
  category: "read",
  description:
    "Kudos received per person, read by the Kudos page's rules (the page shows no counts, only who hasn't been thanked: rosterWithNone below): replies and example kudos are left out, and a kudos counts for a roster member by toMemberId, else by name (trimmed, case-insensitive). Params (all optional): sprintId (that sprint's start to end day), or from/to (YYYY-MM-DD local days, both included; to defaults to today, from to the first kudos); none = all time. Returns {total, byRecipient (name -> count), bySender (name -> count), themeCounts, sentimentCounts (positive/neutral/backhanded), topRecipients: {name, count}[] (desc), received: {key, name, memberId?, onRoster, count, fromPeople, lastAt}[] (most first), rosterWithNone: {memberId, name}[] (roster members with no kudos in the window), topShare (0-1, the top recipient's share; null with none), enough (total >= 5, the minimum before shares and hints mean anything), hints: {kind: 'none-received' | 'concentrated', memberIds, names, sentence}[] (empty until enough and a roster of 2+), window: {from, to, sprintId?, sprintName?} | null}, or {error: 'unknown_sprint' | 'sprint_has_no_dates' | 'from_after_to'}.",
  paramsSchema: statsParams,
  handler: async (params) =>
    statsFor(params, ws().kudos ?? [], ws().teamMembers ?? [], () => ws().sprints ?? []),
  mcpHandler: async (params, ctx) => {
    const [kudos, roster] = await Promise.all([
      serverListEntities<Kudos>(ctx.userId, KIND_K),
      serverListEntities<TeamMember>(ctx.userId, KIND_TEAM),
    ]);
    return statsFor(params, kudos, roster, () =>
      serverListEntities<Sprint>(ctx.userId, KIND_SPRINT)
    );
  },
});

// ──────── tool.kudos.post_kudos ────────
registry.register({
  id: "tool.kudos.post_kudos",
  toolId: "tool.kudos",
  name: "post_kudos",
  category: "write",
  requiresConfirmation: false,
  description:
    "Post a kudo to the wall, on one of the printed Agile at Work cards. episode (optional, 1-26) picks that book episode's card (its headline, quote, lesson and comic panel show on the card, read from the print campaign's data); theme may then be left out, as it is the episode's habit. theme (optional) is one of focus, ownership, real-needs, trust (a habit: it needs an episode of that habit, else error 'episode_required', or 'theme_episode_mismatch' for another habit's episode, each with a message naming what fits), open-thank-you (Thank you!) or open-teamwork (Great teamwork!); an open card may carry an episode, the one it reminds the sender of. With neither, it is a Thank you! card. Any other theme, the tool's original ids included (awesome, thank-you, great-job, congratulations, very-happy, you-rock, well-done), returns error 'invalid_theme'. fromName defaults to 'AI Assistant'. toMemberId (optional) is the roster member (TeamMember.id) it is for, so a later rename keeps it counted for them; it must be on the roster, toName must be that member's name (trimmed, case-insensitive), and the kudos is saved with the roster's spelling. Validated via parseKudos. Returns {posted: false, error, message?} on a rejected card or shape (error 'unknown_member' for a toMemberId off the roster, 'name_mismatch' when toName isn't that member), else {posted: true, id}.",
  paramsSchema: z.object({
    toName: z.string().min(1).max(80),
    message: z.string().min(1).max(2000),
    fromName: z.string().min(1).max(80).optional(),
    theme: z.string().max(64).optional(),
    episode: z.number().int().min(1).max(26).optional(),
    teamName: z.string().min(1).max(80).optional(),
    toProfileId: z.string().min(1).max(64).optional(),
    toMemberId: z.string().min(1).max(64).optional(),
    fromProfileId: z.string().min(1).max(64).optional(),
  }),
  handler: async (params) => {
    const card = pickCard(params.theme, params.episode);
    if (!card.ok) return refused(card);
    const member = params.toMemberId
      ? (ws().teamMembers ?? []).find((m) => m.id === params.toMemberId)
      : undefined;
    const checked = withMember(params, member);
    if (!checked.ok) return { posted: false, error: checked.error };
    const parsed = parseKudos(buildKudo(checked.params, card));
    if (!parsed.ok) return { posted: false, error: parsed.error };
    ws().upsertKudos(parsed.kudos);
    return { posted: true, id: parsed.kudos.id };
  },
  mcpHandler: async (params, ctx) => {
    const card = pickCard(params.theme, params.episode);
    if (!card.ok) return refused(card);
    const member = params.toMemberId
      ? await serverGetEntity<TeamMember>(ctx.userId, KIND_TEAM, params.toMemberId)
      : undefined;
    const checked = withMember(params, member ?? undefined);
    if (!checked.ok) return { posted: false, error: checked.error };
    const parsed = parseKudos(buildKudo(checked.params, card));
    if (!parsed.ok) return { posted: false, error: parsed.error };
    await serverUpsertEntity<Kudos>(ctx.userId, KIND_K, parsed.kudos);
    return { posted: true, id: parsed.kudos.id };
  },
});

// ──────── tool.kudos.remove_kudos ────────
registry.register({
  id: "tool.kudos.remove_kudos",
  toolId: "tool.kudos",
  name: "remove_kudos",
  category: "write",
  requiresConfirmation: false,
  description:
    "Remove a kudo by id. Returns {removed: false} for an unknown id, else {removed: true}.",
  paramsSchema: z.object({ id: z.string() }),
  handler: async (params) => {
    if (!(ws().kudos ?? []).some((k) => k.id === params.id)) return { removed: false };
    ws().removeKudos(params.id);
    return { removed: true };
  },
  mcpHandler: async (params, ctx) => {
    const existing = await serverGetEntity<Kudos>(ctx.userId, KIND_K, params.id);
    if (!existing) return { removed: false };
    await serverDeleteEntity(ctx.userId, KIND_K, params.id);
    return { removed: true };
  },
});
