/**
 * Reading a stored round without a meeting (Planning Poker) into a shape
 * every reader can use. The slice has no CRUD, so nothing checks a row's
 * shape on the way in: an imported workspace file, a hand edit or another
 * device's copy can hold a round with no `createdAt`, `stories` or
 * `replies`, and the readers (the queue hold, the 14-day expiry, the reveal
 * step) would throw on it, taking Planning Poker, the Estimation Guide and
 * their next steps down with it.
 *
 * A row with no id, no usable `createdAt` or an unknown status is left out.
 * Otherwise each list keeps only its well-formed entries, within
 * POKER_ASYNC_MAX, and a malformed optional field is dropped. A row that is
 * already well formed reads back as the same object, so the page's
 * "write what changed" checks (`read !== stored`) stay quiet.
 *
 * Pure and server-safe: the store, its import and the MCP verbs use it, so
 * it holds only the types and the caps.
 */

import {
  POKER_ASYNC_MAX,
  POKER_ASYNC_STATUSES,
  type PokerAsyncReply,
  type PokerAsyncRound,
  type PokerAsyncStory,
} from "@/lib/stores/workspace-types";

type Row = Record<string, unknown>;

const isRow = (v: unknown): v is Row => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === "string";
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const STATUSES: ReadonlySet<unknown> = new Set(POKER_ASYNC_STATUSES);

/** A "YYYY-MM-DD…" stamp whose day is a real date (the expiry counts days from it). */
function isDayStamp(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(v)) return false;
  const [y, m, d] = v.slice(0, 10).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/**
 * `raw` itself when it is an array of at most `max` entries that all pass
 * `read` unchanged; otherwise the entries `read` keeps, up to `max`.
 */
function listOf<T>(raw: unknown, max: number, read: (v: unknown) => T | null): T[] {
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  let same = raw.length <= max;
  for (const v of raw) {
    const kept = read(v);
    if (kept === null) {
      same = false;
      continue;
    }
    if (kept !== v) same = false;
    if (out.length < max) out.push(kept);
  }
  return same ? (raw as T[]) : out;
}

const readCard = (v: unknown): string | null => (isText(v) && v.length > 0 ? v : null);

function readStory(v: unknown): PokerAsyncStory | null {
  if (!isRow(v) || !isId(v.id) || !isText(v.title)) return null;
  const badEstimate = v.finalEstimate !== undefined && !isText(v.finalEstimate);
  const badDiscuss = v.discuss !== undefined && typeof v.discuss !== "boolean";
  if (!badEstimate && !badDiscuss) return v as unknown as PokerAsyncStory;
  const story: PokerAsyncStory = { id: v.id, title: v.title };
  if (!badEstimate && v.finalEstimate !== undefined)
    story.finalEstimate = v.finalEstimate as string;
  if (!badDiscuss && v.discuss !== undefined) story.discuss = v.discuss as boolean;
  return story;
}

const readVote = (v: unknown): { storyId: string; card: string } | null =>
  isRow(v) && isId(v.storyId) && isText(v.card) ? (v as { storyId: string; card: string }) : null;

const readNote = (v: unknown): { storyId: string; text: string } | null =>
  isRow(v) && isId(v.storyId) && isText(v.text) ? (v as { storyId: string; text: string }) : null;

function readReply(v: unknown): PokerAsyncReply | null {
  if (!isRow(v) || !isId(v.id) || !isText(v.name) || !isText(v.at)) return null;
  const votes = listOf(v.votes, POKER_ASYNC_MAX.stories, readVote);
  const notes =
    v.notes === undefined ? undefined : listOf(v.notes, POKER_ASYNC_MAX.notesPerReply, readNote);
  const name =
    v.name.length > POKER_ASYNC_MAX.name ? v.name.slice(0, POKER_ASYNC_MAX.name) : v.name;
  if (votes === v.votes && notes === v.notes && name === v.name) {
    return v as unknown as PokerAsyncReply;
  }
  return { id: v.id, name, votes, ...(notes && notes.length > 0 ? { notes } : {}), at: v.at };
}

const readName = (v: unknown): string | null => (isText(v) ? v : null);

/** A stored round in a shape every reader can use, or null when it can't be read at all. */
export function readPokerAsyncRound(raw: unknown): PokerAsyncRound | null {
  if (!isRow(raw) || !isId(raw.id) || !isDayStamp(raw.createdAt) || !STATUSES.has(raw.status)) {
    return null;
  }
  const deck = listOf(raw.deck, POKER_ASYNC_MAX.deck, readCard);
  const stories = listOf(raw.stories, POKER_ASYNC_MAX.stories, readStory);
  const replies = listOf(raw.replies, POKER_ASYNC_MAX.replies, readReply);
  // A list that isn't one is dropped, so the round expects nobody in particular.
  const expected = Array.isArray(raw.expected)
    ? listOf(raw.expected, POKER_ASYNC_MAX.expected, readName)
    : undefined;
  const title = isText(raw.title) ? raw.title : "";
  const scaleType = isText(raw.scaleType) ? raw.scaleType : "custom";
  const updatedAt = isText(raw.updatedAt) ? raw.updatedAt : raw.createdAt;
  const dueOk =
    raw.dueDate === undefined ||
    (isText(raw.dueDate) && /^\d{4}-\d{2}-\d{2}$/.test(raw.dueDate) && isDayStamp(raw.dueDate));
  const meaningsOk = raw.withMeanings === undefined || typeof raw.withMeanings === "boolean";
  const revealedOk = raw.revealedAt === undefined || isText(raw.revealedAt);
  const closedOk = raw.closedAt === undefined || isText(raw.closedAt);
  if (
    deck === raw.deck &&
    stories === raw.stories &&
    replies === raw.replies &&
    expected === raw.expected &&
    title === raw.title &&
    scaleType === raw.scaleType &&
    updatedAt === raw.updatedAt &&
    dueOk &&
    meaningsOk &&
    revealedOk &&
    closedOk
  ) {
    return raw as unknown as PokerAsyncRound;
  }
  const round: PokerAsyncRound = {
    id: raw.id,
    title,
    scaleType,
    deck,
    stories,
    replies,
    status: raw.status as PokerAsyncRound["status"],
    createdAt: raw.createdAt,
    updatedAt,
  };
  if (expected) round.expected = expected;
  if (dueOk && raw.dueDate !== undefined) round.dueDate = raw.dueDate as string;
  if (meaningsOk && raw.withMeanings !== undefined)
    round.withMeanings = raw.withMeanings as boolean;
  if (revealedOk && raw.revealedAt !== undefined) round.revealedAt = raw.revealedAt as string;
  if (closedOk && raw.closedAt !== undefined) round.closedAt = raw.closedAt as string;
  return round;
}

/**
 * The rounds a stored list holds, each read by readPokerAsyncRound (the
 * unreadable ones left out). The same array when every row is well formed.
 */
export function readAsyncRounds(raw: unknown): PokerAsyncRound[] {
  if (!Array.isArray(raw)) return [];
  let same = true;
  const out: PokerAsyncRound[] = [];
  for (const v of raw) {
    const round = readPokerAsyncRound(v);
    if (round !== v) same = false;
    if (round) out.push(round);
  }
  return same ? (raw as PokerAsyncRound[]) : out;
}
