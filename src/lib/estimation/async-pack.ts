/**
 * Estimate without a meeting (Planning Poker): the link that carries a
 * round's stories out, the short reply code that carries each person's
 * cards back, and what the host makes of the replies.
 *
 * There is no live room and no migration. The host's page packs the round
 * into a link (`#estimate=`, a fragment, so browsers never send it to the
 * server); the estimator's page (/planning-poker/estimate) shows the stories,
 * keeps the picks in memory and makes a reply code; the estimator sends the
 * code to the host however they like, and the host pastes it in. The rounds,
 * with the replies pasted into them, are a synced workspace collection, so
 * they live in the host's workspace (ASYNC_ESTIMATE_NOTICE says so to the
 * estimator) until the round closes or expires.
 *
 * - **Pack**: base64url JSON `{v:1, r, t, h?, d[], s[], due?, m?}`, at most
 *   PACK_MAX_CHARS. `r` is the round id, `t` its title, `h` the host's name,
 *   `d` the deck, `s` the story titles in order, `due` the due day, `m` the
 *   Estimation Guide's meaning of each card (opt-in). Reference stories are
 *   never in it, as the guide's own share link leaves them out. Over the cap
 *   the meanings go first, then it refuses ("Split into two rounds").
 * - **Reply**: "AT1." + base64url `{v:1, r, n, e, c?}`, at most
 *   REPLY_MAX_CHARS. `e` is one character per story, the card's index on the
 *   round's deck ("0" to "f": a deck holds at most 16 cards) or "-" for none;
 *   `c` is at most 5 notes `[storyIndex, text]`. 20 cards, a 40-character
 *   name and 5 full notes fit the cap in any script (3 bytes a character).
 * - **Every read is hostile**: size first, then a strict shape (no unknown
 *   keys), text through cleanText/cleanName and refused over its cap, deck
 *   indexes on the deck and story indexes in range, and the round id must
 *   match a round in this browser (`replyProblem`).
 *
 * A reply code is packed, not sealed: anyone who sees it can read its cards,
 * so the estimator's page says to send it to the facilitator only.
 *
 * Pure and server-safe (the agent's verbs use it): no store, no React.
 */

import { fromBase64Url, toBase64Url } from "@/lib/realtime/vote-room/crypto";
import { cleanName, cleanText, shareableText } from "@/lib/realtime/sanitize";
import { nameKey } from "@/lib/team/names";
import {
  POKER_ASYNC_MAX,
  type PokerAsyncReply,
  type PokerAsyncRound,
  type PokerAsyncStory,
} from "@/lib/stores/workspace-types";
import {
  consensusLabel,
  consensusOf,
  consensusVerdict,
  estimateCards,
  type Consensus,
  type ConsensusLevel,
} from "./consensus";
import { SCALES, type ScaleType } from "./decks";
import {
  ASYNC_ROUND_PREFIX,
  DUE_MAX_DAYS,
  ESTIMATE_PATH,
  latestDueDay,
  revealRound,
} from "./async-rounds";

export * from "./async-rounds";

/** The longest pack, in base64url characters. */
export const PACK_MAX_CHARS = 6000;
/** The longest reply code, "AT1." included. */
export const REPLY_MAX_CHARS = 3200;
/** Every reply code starts with this. */
export const REPLY_PREFIX = "AT1.";
/** A card's meaning in the pack. */
export const MEANING_MAX = 120;
/** A card's longest text, as the Poker deck allows. */
export const CARD_MAX = 32;

/** A round id as the page makes them: "async_" and 4 to 40 id characters. */
export const ROUND_ID_RE = /^async_[A-Za-z0-9_-]{4,40}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const REPLY_CODE_RE = /AT1\.[A-Za-z0-9_-]+/g;
/** Text pasted into the host's box: more than this is never a few codes. */
const PASTE_MAX_CHARS = 80_000;

export const SPLIT_ROUND = "Too long for one link. Split the stories into two rounds.";
export const DUE_TOO_FAR = `Pick a day in the next ${DUE_MAX_DAYS} days.`;
export const NOT_IN_BROWSER =
  "This reply is for a round that isn't in this browser. Open it on the device that made the round.";

// ── Text ──────────────────────────────────────────────────────────────

/** `s` without lone surrogates, which JSON would escape to 6 bytes each. */
export function wellFormed(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += s[i] + s[i + 1];
        i++;
      }
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) continue;
    out += s[i];
  }
  return out;
}

/** One line of text cleaned for a pack or a round, cut to `max`. Null when nothing is left. */
export function cleanLine(raw: unknown, max: number): string | null {
  return typeof raw === "string" ? cleanText(wellFormed(raw), max) : null;
}

/**
 * Text a person typed or pasted on their own page: the host's round name,
 * story titles (typed or queued), expected names and card meanings, or the
 * estimator's name and notes. One line with hidden direction and control
 * characters stripped, not refused (`shareableText`), cut to `max`. Pasted
 * Arabic or Hebrew often holds an invisible mark the person can't see to
 * take out. Null when nothing is left. What a link or a reply code carries
 * in is still read with `cleanLine`/`cleanReplyName`, which refuse them.
 */
export function typedLine(raw: unknown, max: number = PASTE_MAX_CHARS): string | null {
  return typeof raw === "string" ? shareableText(wellFormed(raw), max) || null : null;
}

/** A name cleaned for a reply (POKER_ASYNC_MAX.name). Null when nothing is left. */
export function cleanReplyName(raw: unknown): string | null {
  return typeof raw === "string" ? cleanName(wellFormed(raw), POKER_ASYNC_MAX.name) : null;
}

/** Read from a code: refused over `max`, never cut. */
function strictLine(raw: unknown, max: number): string | null {
  if (typeof raw !== "string" || raw.length > max) return null;
  return cleanLine(raw, max);
}

function strictName(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > POKER_ASYNC_MAX.name) return null;
  return cleanReplyName(raw);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function onlyKeys(o: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(o).every((k) => keys.includes(k));
}

/** A real calendar day, "YYYY-MM-DD". */
export function isDay(v: unknown): v is string {
  if (typeof v !== "string" || !DAY_RE.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function encodeJson(value: unknown): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function decodeJson(code: string): unknown {
  const bytes = fromBase64Url(code);
  if (!bytes) return undefined;
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return undefined;
  }
}

// ── Decks ─────────────────────────────────────────────────────────────

/** A typed custom deck as cards: split on commas, trimmed, blanks dropped. */
export function parseAsyncDeck(input: string): string[] {
  return input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The deck a round plays with. */
export function asyncDeckFor(scaleType: ScaleType, customInput = ""): string[] {
  return scaleType === "custom" ? parseAsyncDeck(customInput) : [...SCALES[scaleType]];
}

/** Why a deck can't be a round's, or null when it can. */
export function asyncDeckProblem(cards: readonly string[]): string | null {
  if (cards.length < 2) return "Enter at least two values, separated by commas.";
  if (cards.length > POKER_ASYNC_MAX.deck) {
    return `A round without a meeting takes up to ${POKER_ASYNC_MAX.deck} cards.`;
  }
  const seen = new Set<string>();
  for (const c of cards) {
    if (c.length > CARD_MAX) return `Keep each card to ${CARD_MAX} characters.`;
    if (cleanLine(c, CARD_MAX) !== c) return `“${c.slice(0, 12)}” can't be a card.`;
    if (seen.has(c)) return `“${c}” is on the deck twice.`;
    seen.add(c);
  }
  if (estimateCards(cards).length === 0) return "Add at least one size, not only ? or ∞.";
  return null;
}

function checkDeck(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const cards: string[] = [];
  for (const c of raw) {
    const card = strictLine(c, CARD_MAX);
    if (card === null) return null;
    cards.push(card);
  }
  return asyncDeckProblem(cards) === null ? cards : null;
}

// ── A new round ───────────────────────────────────────────────────────

export interface AsyncRoundInput {
  title: string;
  scaleType: ScaleType;
  deck: readonly string[];
  /** Ids and titles, in order: a queue story's id is its stamped sessionStoryId. */
  stories: readonly { id: string; title: string }[];
  expected?: readonly string[];
  /** "YYYY-MM-DD", today or later. */
  dueDate?: string;
  withMeanings?: boolean;
}

/** Why `input` can't become a round, or null. `today` is the local day. */
export function asyncRoundProblem(input: AsyncRoundInput, today: string): string | null {
  const title = typedLine(input.title);
  if (!title) return "Name the round.";
  if (title.length > POKER_ASYNC_MAX.title) {
    return `Keep the round's name to ${POKER_ASYNC_MAX.title} characters.`;
  }
  const deck = asyncDeckProblem(input.deck);
  if (deck) return deck;
  if (input.stories.length === 0) return "Add at least one story.";
  if (input.stories.length > POKER_ASYNC_MAX.stories) {
    return `A round takes up to ${POKER_ASYNC_MAX.stories} stories. Split them into two rounds.`;
  }
  for (const s of input.stories) {
    const story = typedLine(s.title);
    if (!story) return "Every story needs a title.";
    if (story.length > POKER_ASYNC_MAX.storyTitle) {
      return `Keep each story title to ${POKER_ASYNC_MAX.storyTitle} characters.`;
    }
  }
  if ((input.expected?.length ?? 0) > POKER_ASYNC_MAX.expected) {
    return `Name up to ${POKER_ASYNC_MAX.expected} people.`;
  }
  for (const n of input.expected ?? []) {
    const name = typedLine(n);
    if (!name || name.length > POKER_ASYNC_MAX.name) {
      return `Keep each name to ${POKER_ASYNC_MAX.name} characters.`;
    }
  }
  if (input.dueDate !== undefined && input.dueDate !== "") {
    if (!isDay(input.dueDate)) return "Pick a due day.";
    if (input.dueDate < today) return "Pick today or a later day.";
    if (input.dueDate > latestDueDay(today)) return DUE_TOO_FAR;
  }
  return null;
}

/** A new open round from checked input (`asyncRoundProblem` gave null). */
export function newAsyncRound(input: AsyncRoundInput, id: string, now: string): PokerAsyncRound {
  // Each person once, as first written.
  const expected: string[] = [];
  for (const raw of input.expected ?? []) {
    const n = typedLine(raw, POKER_ASYNC_MAX.name);
    if (n && !expected.some((e) => nameKey(e) === nameKey(n))) expected.push(n);
  }
  return {
    id,
    title: typedLine(input.title, POKER_ASYNC_MAX.title) ?? "Estimates",
    scaleType: input.scaleType,
    deck: [...input.deck],
    stories: input.stories.map((s) => ({
      id: s.id,
      title: typedLine(s.title, POKER_ASYNC_MAX.storyTitle) ?? "Untitled story",
    })),
    ...(expected.length > 0 ? { expected } : {}),
    ...(input.dueDate ? { dueDate: input.dueDate } : {}),
    ...(input.withMeanings ? { withMeanings: true } : {}),
    replies: [],
    status: "open",
    createdAt: now,
    updatedAt: now,
  };
}

/** A fresh round id. */
export function newAsyncRoundId(): string {
  return `${ASYNC_ROUND_PREFIX}${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

// ── The pack ──────────────────────────────────────────────────────────

export interface AsyncPack {
  v: 1;
  r: string;
  t: string;
  h?: string;
  d: string[];
  s: string[];
  due?: string;
  m?: string[];
}

/**
 * What the link carries for `round`. `meanings` is the guide's meaning of
 * each card in deck order ("" for none); it goes in only when the round
 * asked for it.
 */
export function packFor(
  round: PokerAsyncRound,
  opts: { host?: string; meanings?: readonly string[] } = {}
): AsyncPack {
  const host = typedLine(opts.host ?? "", POKER_ASYNC_MAX.name);
  const meanings =
    round.withMeanings && opts.meanings && opts.meanings.length === round.deck.length
      ? opts.meanings.map((m) => typedLine(m, MEANING_MAX) ?? "")
      : null;
  return {
    v: 1,
    r: round.id,
    t: round.title,
    ...(host ? { h: host } : {}),
    d: [...round.deck],
    s: round.stories.map((s) => s.title),
    ...(round.dueDate ? { due: round.dueDate } : {}),
    ...(meanings && meanings.some(Boolean) ? { m: meanings } : {}),
  };
}

export type PackResult =
  | { ok: true; code: string; chars: number; meaningsDropped: boolean }
  | { ok: false; problem: string };

/** The pack as a link code: without the meanings when they don't fit, refused when nothing does. */
export function encodePack(pack: AsyncPack): PackResult {
  const code = encodeJson(pack);
  if (code.length <= PACK_MAX_CHARS) {
    return { ok: true, code, chars: code.length, meaningsDropped: false };
  }
  if (pack.m) {
    const rest: AsyncPack = { ...pack };
    delete rest.m;
    const shorter = encodeJson(rest);
    if (shorter.length <= PACK_MAX_CHARS) {
      return { ok: true, code: shorter, chars: shorter.length, meaningsDropped: true };
    }
  }
  return { ok: false, problem: SPLIT_ROUND };
}

/** The estimator's link for a pack code: a path, or a full address with `origin`. */
export function estimateLink(code: string, origin = ""): string {
  return `${origin}${ESTIMATE_PATH}#estimate=${code}`;
}

const PACK_KEYS = ["v", "r", "t", "h", "d", "s", "due", "m"] as const;

/** The pack in a page's hash ("#estimate=…"), or null for anything else. */
export function readPack(hash: unknown): AsyncPack | null {
  if (typeof hash !== "string" || hash.length > PACK_MAX_CHARS + 16) return null;
  const match = /^#?estimate=([A-Za-z0-9_-]+)$/.exec(hash.trim());
  if (!match || match[1].length > PACK_MAX_CHARS) return null;
  const raw = decodeJson(match[1]);
  if (!isPlainObject(raw) || !onlyKeys(raw, PACK_KEYS) || raw.v !== 1) return null;
  if (typeof raw.r !== "string" || !ROUND_ID_RE.test(raw.r)) return null;
  const t = strictLine(raw.t, POKER_ASYNC_MAX.title);
  if (!t) return null;
  const pack: AsyncPack = { v: 1, r: raw.r, t, d: [], s: [] };
  if (raw.h !== undefined) {
    const h = strictName(raw.h);
    if (!h) return null;
    pack.h = h;
  }
  const deck = checkDeck(raw.d);
  if (!deck) return null;
  pack.d = deck;
  if (!Array.isArray(raw.s) || raw.s.length < 1 || raw.s.length > POKER_ASYNC_MAX.stories) {
    return null;
  }
  for (const s of raw.s) {
    const title = strictLine(s, POKER_ASYNC_MAX.storyTitle);
    if (!title) return null;
    pack.s.push(title);
  }
  if (raw.due !== undefined) {
    if (!isDay(raw.due)) return null;
    pack.due = raw.due;
  }
  if (raw.m !== undefined) {
    if (!Array.isArray(raw.m) || raw.m.length !== deck.length) return null;
    const meanings: string[] = [];
    for (const m of raw.m) {
      if (m === "") {
        meanings.push("");
        continue;
      }
      const meaning = strictLine(m, MEANING_MAX);
      if (meaning === null) return null;
      meanings.push(meaning);
    }
    pack.m = meanings;
  }
  return pack;
}

// ── Replies ───────────────────────────────────────────────────────────

/** A reply code, read: whose, for which round, and what it holds. */
export interface AsyncReplyCode {
  roundId: string;
  name: string;
  /** One character per story: the card's index on the deck in hex, or "-". */
  cards: string;
  notes: { story: number; text: string }[];
}

/** What the estimator (or the host, for their own cards) filled in. */
export interface ReplyDraft {
  name: string;
  /** A card per story, in story order; null for none. */
  picks: (string | null)[];
  /** Notes by story index; blank ones are left out. */
  notes: { story: number; text: string }[];
}

export type ReplyField = "name" | "cards" | "notes";

export type ReplyValidation =
  | { ok: true; values: { code: string; reply: AsyncReplyCode } }
  | { ok: false; errors: Partial<Record<ReplyField, string>> };

/** Check a reply against the round it answers (its id, deck and stories), and make its code. */
export function validateReply(
  target: Pick<AsyncPack, "r" | "d" | "s">,
  draft: ReplyDraft
): ReplyValidation {
  const errors: Partial<Record<ReplyField, string>> = {};
  const name = typedLine(draft.name);
  if (!name) errors.name = "Enter your name, so the facilitator knows whose cards these are.";
  else if (name.length > POKER_ASYNC_MAX.name) {
    errors.name = `Keep your name to ${POKER_ASYNC_MAX.name} characters.`;
  }
  const picks = target.s.map((_, i) => draft.picks[i] ?? null);
  const cards = picks
    .map((p) => {
      const at = p === null ? -1 : target.d.indexOf(p);
      return at === -1 ? "-" : at.toString(16);
    })
    .join("");
  if (!/[0-9a-f]/.test(cards)) errors.cards = "Pick a card for at least one story.";
  const byStory = new Map<number, string>();
  for (const n of draft.notes) {
    if (!Number.isInteger(n.story) || n.story < 0 || n.story >= target.s.length) continue;
    const text = typedLine(n.text, POKER_ASYNC_MAX.note);
    if (text) byStory.set(n.story, text);
    else byStory.delete(n.story);
  }
  if (byStory.size > POKER_ASYNC_MAX.notesPerReply) {
    errors.notes = `Add up to ${POKER_ASYNC_MAX.notesPerReply} notes.`;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const notes = Array.from(byStory.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([story, text]) => ({ story, text }));
  const reply: AsyncReplyCode = { roundId: target.r, name: name as string, cards, notes };
  const code = encodeReply(reply);
  if (code.length > REPLY_MAX_CHARS) {
    return { ok: false, errors: { notes: "Shorten your notes: the reply is too long to send." } };
  }
  return { ok: true, values: { code, reply } };
}

/** A reply as its code. */
export function encodeReply(reply: AsyncReplyCode): string {
  const body: Record<string, unknown> = { v: 1, r: reply.roundId, n: reply.name, e: reply.cards };
  if (reply.notes.length > 0) body.c = reply.notes.map((n) => [n.story, n.text]);
  return `${REPLY_PREFIX}${encodeJson(body)}`;
}

/**
 * The reply codes in pasted text (a code, a link holding one, or several),
 * each once, at most 20. A message often holds a code and the link it came
 * in: that's one reply, not two.
 */
export function findReplyCodes(text: unknown): string[] {
  if (typeof text !== "string" || text.length > PASTE_MAX_CHARS) return [];
  const codes = new Set(Array.from(text.matchAll(REPLY_CODE_RE), (m) => m[0]));
  return Array.from(codes).slice(0, POKER_ASYNC_MAX.replies);
}

const REPLY_KEYS = ["v", "r", "n", "e", "c"] as const;

/** A reply code (or text holding one), read; null for anything else. */
export function readReply(raw: unknown): AsyncReplyCode | null {
  if (typeof raw !== "string" || raw.length > PASTE_MAX_CHARS) return null;
  const found = /AT1\.([A-Za-z0-9_-]+)/.exec(raw);
  if (!found || found[0].length > REPLY_MAX_CHARS) return null;
  const body = decodeJson(found[1]);
  if (!isPlainObject(body) || !onlyKeys(body, REPLY_KEYS) || body.v !== 1) return null;
  if (typeof body.r !== "string" || !ROUND_ID_RE.test(body.r)) return null;
  const name = strictName(body.n);
  if (!name) return null;
  if (typeof body.e !== "string" || !/^[0-9a-f-]{1,20}$/.test(body.e)) return null;
  const notes: { story: number; text: string }[] = [];
  if (body.c !== undefined) {
    if (!Array.isArray(body.c) || body.c.length > POKER_ASYNC_MAX.notesPerReply) return null;
    const seen = new Set<number>();
    for (const n of body.c) {
      if (!Array.isArray(n) || n.length !== 2) return null;
      const [story, text] = n as unknown[];
      if (typeof story !== "number" || !Number.isInteger(story)) return null;
      if (story < 0 || story >= body.e.length || seen.has(story)) return null;
      const clean = strictLine(text, POKER_ASYNC_MAX.note);
      if (!clean) return null;
      seen.add(story);
      notes.push({ story, text: clean });
    }
  }
  return { roundId: body.r, name, cards: body.e, notes };
}

/** Why `reply` can't go on `round` (the round this browser holds by its id), or null. */
export function replyProblem(
  reply: AsyncReplyCode,
  round: PokerAsyncRound | undefined | null
): string | null {
  if (!round || round.id !== reply.roundId) return NOT_IN_BROWSER;
  if (round.status === "closed") return `“${round.title}” is closed, so it takes no more replies.`;
  if (reply.cards.length !== round.stories.length) {
    return `This reply doesn't match the stories in “${round.title}”.`;
  }
  for (const c of reply.cards) {
    if (c !== "-" && parseInt(c, 16) >= round.deck.length) {
      return `This reply has a card that isn't on the deck of “${round.title}”.`;
    }
  }
  if (!/[0-9a-f]/.test(reply.cards)) return "This reply has no cards.";
  if (reply.notes.some((n) => n.story >= round.stories.length)) {
    return `This reply doesn't match the stories in “${round.title}”.`;
  }
  if (round.replies.length >= POKER_ASYNC_MAX.replies && !replyClash(reply, round)) {
    return `“${round.title}” already holds ${POKER_ASYNC_MAX.replies} replies.`;
  }
  return null;
}

/** The reply already in `round` under the same name (any case), if any. */
export function replyClash(
  reply: Pick<AsyncReplyCode, "name">,
  round: PokerAsyncRound
): PokerAsyncReply | null {
  const key = nameKey(reply.name);
  return round.replies.find((r) => r.name !== "" && nameKey(r.name) === key) ?? null;
}

/** A reply's cards and notes as the round holds them, under its story ids. */
function replyContent(
  reply: AsyncReplyCode,
  round: PokerAsyncRound
): Pick<PokerAsyncReply, "votes"> & { notes: NonNullable<PokerAsyncReply["notes"]> } {
  const votes: PokerAsyncReply["votes"] = [];
  Array.from(reply.cards).forEach((c, i) => {
    if (c === "-") return;
    votes.push({ storyId: round.stories[i].id, card: round.deck[parseInt(c, 16)] });
  });
  const notes = reply.notes.map((n) => ({ storyId: round.stories[n.story].id, text: n.text }));
  return { votes, notes };
}

/** A name without the " (2)" Keep both gave it. */
const baseNameKey = (name: string) => nameKey(name.replace(/ \(\d+\)$/, ""));

/**
 * Whether `round` already holds this very reply: the same person (by name,
 * or the "Lee (2)" Keep both made) with the same cards and notes. Pasting
 * the same message twice adds nothing and asks nothing.
 */
export function isReplyIn(reply: AsyncReplyCode, round: PokerAsyncRound): boolean {
  if (replyProblem(reply, round)) return false;
  const key = nameKey(reply.name);
  const { votes, notes } = replyContent(reply, round);
  const same = JSON.stringify([votes, notes]);
  return round.replies.some(
    (r) =>
      r.name !== "" &&
      (nameKey(r.name) === key || baseNameKey(r.name) === key) &&
      JSON.stringify([r.votes, r.notes ?? []]) === same
  );
}

/** "Lee (2)", "Lee (3)" … : the first name with a number that no reply has. */
export function keepBothName(name: string, replies: readonly PokerAsyncReply[]): string {
  const taken = new Set(replies.map((r) => nameKey(r.name)));
  for (let n = 2; n <= POKER_ASYNC_MAX.replies + 1; n++) {
    const suffix = ` (${n})`;
    const base = name.slice(0, POKER_ASYNC_MAX.name - suffix.length).trimEnd();
    const candidate = `${base}${suffix}`;
    if (!taken.has(nameKey(candidate))) return candidate;
  }
  return name;
}

/**
 * `round` with `reply` added. A reply under a name already in decides with
 * `mode`: "replace" takes the earlier one out, "keep-both" numbers the new
 * one ("Lee (2)"). Nothing is replaced unless asked. The round comes back
 * unchanged when the reply can't go on it (`replyProblem`).
 */
export function addReply(
  round: PokerAsyncRound,
  reply: AsyncReplyCode,
  mode: "replace" | "keep-both",
  opts: { id: string; at: string }
): PokerAsyncRound {
  if (replyProblem(reply, round)) return round;
  const clash = replyClash(reply, round);
  let replies = round.replies;
  let name = reply.name;
  if (clash && mode === "replace") {
    replies = replies.filter((r) => r.name === "" || nameKey(r.name) !== nameKey(reply.name));
  } else if (clash) {
    name = keepBothName(reply.name, replies);
  }
  if (replies.length >= POKER_ASYNC_MAX.replies) return round;
  const { votes, notes } = replyContent(reply, round);
  const added: PokerAsyncReply = {
    id: opts.id,
    name,
    votes,
    ...(notes.length > 0 ? { notes } : {}),
    at: opts.at,
  };
  return { ...round, replies: [...replies, added], updatedAt: opts.at };
}

// ── Results ───────────────────────────────────────────────────────────

export interface AsyncVote {
  /** "" once the round is closed. */
  name: string;
  card: string;
}

export interface AsyncStoryResult {
  story: PokerAsyncStory;
  /** Low to high, as Poker's revealed rounds sort them. */
  votes: AsyncVote[];
  consensus: Consensus;
  /** "Full consensus", "One estimate" …; null when nobody estimated. */
  label: string | null;
  tone: ConsensusLevel | null;
  verdict: string;
  notes: { name: string; text: string }[];
}

function isNumericCard(v: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(v.trim()) && !isNaN(Number(v));
}

/** Low to high: numbers first in value order, then the rest in deck order (as Poker's `sortVotes`). */
function sortByDeck<T extends { card: string }>(items: readonly T[], deck: readonly string[]): T[] {
  const rank = (c: string) => {
    const i = deck.indexOf(c);
    return i === -1 ? deck.length : i;
  };
  return [...items].sort((a, b) => {
    const an = isNumericCard(a.card);
    const bn = isNumericCard(b.card);
    if (an && bn) return Number(a.card) - Number(b.card);
    if (an !== bn) return an ? -1 : 1;
    return rank(a.card) - rank(b.card);
  });
}

/** Per story: the votes, how close they are, the verdict and the notes. */
export function asyncResults(round: PokerAsyncRound): AsyncStoryResult[] {
  return round.stories.map((story) => {
    const votes: AsyncVote[] = [];
    const notes: { name: string; text: string }[] = [];
    for (const reply of round.replies) {
      for (const v of reply.votes) {
        if (v.storyId === story.id && round.deck.includes(v.card)) {
          votes.push({ name: reply.name, card: v.card });
        }
      }
      for (const n of reply.notes ?? []) {
        if (n.storyId === story.id) notes.push({ name: reply.name, text: n.text });
      }
    }
    const sorted = sortByDeck(votes, round.deck);
    const consensus = consensusOf(
      sorted.map((v) => v.card),
      round.deck
    );
    const tag = consensusLabel(consensus);
    return {
      story,
      votes: sorted,
      consensus,
      label: tag?.label ?? null,
      tone: tag?.tone ?? null,
      verdict: consensusVerdict(consensus),
      notes,
    };
  });
}

/** Stories worth talking about live: far apart, or nobody could size them. */
export function needsTalk(result: AsyncStoryResult): boolean {
  if (result.story.finalEstimate) return false;
  const c = result.consensus;
  if (c.level === null) return c.abstained > 0;
  return c.level === "spread" || (c.estimates >= 1 && c.abstained >= c.estimates);
}

/**
 * Reveal, with the stories worth a conversation ticked for "Talk about it
 * live" (`needsTalk`). The same round when it isn't open.
 */
export function revealAndFlag(round: PokerAsyncRound, now: string): PokerAsyncRound {
  const shown = revealRound(round, now);
  if (shown === round) return round;
  const results = asyncResults(shown);
  return {
    ...shown,
    stories: shown.stories.map((s, i) => (needsTalk(results[i]) ? { ...s, discuss: true } : s)),
  };
}

/** How many cards a round holds, for the blind count before Reveal. */
export function cardCount(round: PokerAsyncRound): number {
  return round.replies.reduce((n, r) => n + r.votes.length, 0);
}

/**
 * What Amr may read of a round: counts, the due day and, after Reveal, each
 * story's verdict and agreed card. Never a name, a note or anyone's card.
 */
export function asyncRoundSummary(round: PokerAsyncRound) {
  const shown = round.status !== "open";
  return {
    id: round.id,
    title: round.title,
    status: round.status,
    scaleType: round.scaleType,
    dueDate: round.dueDate ?? null,
    replyCount: round.replies.length,
    expectedCount: round.expected?.length ?? 0,
    storyCount: round.stories.length,
    stories: shown
      ? asyncResults(round).map((r) => ({
          title: r.story.title,
          label: r.label,
          verdict: r.verdict,
          suggested: r.consensus.suggested,
          agreed: r.story.finalEstimate ?? null,
          voteCount: r.votes.length,
        }))
      : null,
  };
}
