/**
 * Lean Coffee on the Retro board: the rules the runner follows.
 *
 * The board's `lean-coffee` format has three columns, To Discuss,
 * Discussing and Done. People write topics in To Discuss and dot-vote them
 * with the board's own voting; in Discuss the runner takes the topics in
 * vote order, one at a time: the topic moves to Discussing with a timebox
 * on the board's timer (7 minutes by default), and when the time is up the
 * room votes thumbs up to keep going (another 3 minutes) or thumbs down to
 * move on, when the topic goes to Done.
 *
 * A topic is a top-level card (cards grouped under it move with it and
 * add their votes to it). Action items are not topics. Everything here is
 * pure: each change returns the next board, which the Board saves through
 * its own updater, so the visitor room's snapshot carries the columns and
 * the timer as it carries any other edit.
 */

import type { BoardState, RetroCard } from "@/app/(tools)/retro/types";

export const LEAN_COFFEE_FORMAT_ID = "lean-coffee";

/** The format's column keys (lib/constants/retro-formats). */
export const LEAN_COFFEE_COLUMNS = {
  todo: "to-discuss",
  now: "discussing",
  done: "done",
} as const;

/** The first timebox for a topic, in minutes. */
export const LEAN_COFFEE_TIMEBOX_MIN = 7;
/** Each "keep going" adds this many minutes. */
export const LEAN_COFFEE_EXTEND_MIN = 3;
/** The timebox choices the runner offers. */
export const LEAN_COFFEE_TIMEBOX_CHOICES = [5, 7, 10, 15] as const;
/** The extension choices the runner offers. */
export const LEAN_COFFEE_EXTEND_CHOICES = [2, 3, 5] as const;

/** Whether a board runs as Lean Coffee: its format, with the three columns. */
export function isLeanCoffee(board: Pick<BoardState, "format">): boolean {
  if (board.format.id !== LEAN_COFFEE_FORMAT_ID) return false;
  const keys = new Set(board.format.columns.map((c) => c.key));
  return Object.values(LEAN_COFFEE_COLUMNS).every((k) => keys.has(k));
}

export interface LeanTopic {
  id: string;
  text: string;
  /** Its own votes and those of the cards grouped under it. */
  votes: number;
  columnKey: string;
  /** The cards grouped under it, which move with it. */
  groupIds: string[];
  /** Where it sits on the board, for a stable order between equal votes. */
  index: number;
}

/** Every topic on the board: top-level cards that aren't action items, with their groups. */
export function leanTopics(cards: readonly RetroCard[]): LeanTopic[] {
  const out: LeanTopic[] = [];
  cards.forEach((c, index) => {
    if (c.groupedWith !== null || c.isActionItem || !c.text.trim()) return;
    const group = cards.filter((g) => g.groupedWith === c.id);
    out.push({
      id: c.id,
      text: c.text,
      votes: Math.max(0, c.votes) + group.reduce((s, g) => s + Math.max(0, g.votes), 0),
      columnKey: c.columnKey,
      groupIds: group.map((g) => g.id),
      index,
    });
  });
  return out;
}

/** Most votes first; equal votes keep the board's order. */
const byVotes = (a: LeanTopic, b: LeanTopic) => b.votes - a.votes || a.index - b.index;

/** The topics still to discuss, in the order they'll be taken. */
export function topicQueue(cards: readonly RetroCard[]): LeanTopic[] {
  return leanTopics(cards)
    .filter((t) => t.columnKey === LEAN_COFFEE_COLUMNS.todo)
    .sort(byVotes);
}

/** The topic being discussed: the first one in Discussing, else null. */
export function currentTopic(cards: readonly RetroCard[]): LeanTopic | null {
  const now = leanTopics(cards).filter((t) => t.columnKey === LEAN_COFFEE_COLUMNS.now);
  return now.find((t) => cards.find((c) => c.id === t.id)?.discussing) ?? now[0] ?? null;
}

/** The topics already discussed, in board order. */
export function doneTopics(cards: readonly RetroCard[]): LeanTopic[] {
  return leanTopics(cards).filter((t) => t.columnKey === LEAN_COFFEE_COLUMNS.done);
}

/** `cards` with one topic (and its group) moved to `columnKey`. */
function moved(
  cards: readonly RetroCard[],
  topicId: string,
  columnKey: string,
  discussing: boolean
): RetroCard[] {
  return cards.map((c) => {
    if (c.id === topicId) return { ...c, columnKey, discussing };
    if (c.groupedWith === topicId) return { ...c, columnKey, discussing: false };
    return c;
  });
}

/**
 * Start a topic: it (and its group) moves to Discussing and is marked as
 * the one being discussed, a topic still in Discussing moves to Done, and
 * the timer is set to `seconds` and started. The board is unchanged when
 * the topic isn't one of its topics.
 */
export function withTopicStarted(board: BoardState, topicId: string, seconds: number): BoardState {
  const topic = leanTopics(board.cards).find((t) => t.id === topicId);
  if (!topic) return board;
  let cards: RetroCard[] = board.cards.map((c) => (c.discussing ? { ...c, discussing: false } : c));
  for (const t of leanTopics(cards)) {
    if (t.id !== topicId && t.columnKey === LEAN_COFFEE_COLUMNS.now) {
      cards = moved(cards, t.id, LEAN_COFFEE_COLUMNS.done, false);
    }
  }
  cards = moved(cards, topicId, LEAN_COFFEE_COLUMNS.now, true);
  return {
    ...board,
    cards,
    timerSeconds: Math.max(1, Math.round(seconds)),
    timerRunning: true,
  };
}

/** Finish a topic: it (and its group) moves to Done, and the timer stops. */
export function withTopicDone(board: BoardState, topicId: string): BoardState {
  if (!board.cards.some((c) => c.id === topicId)) return board;
  return {
    ...board,
    cards: moved(board.cards, topicId, LEAN_COFFEE_COLUMNS.done, false),
    timerRunning: false,
  };
}

/** Keep going: the timer gets `seconds` more and runs. */
export function withTopicExtended(board: BoardState, seconds: number): BoardState {
  return { ...board, timerSeconds: Math.max(1, Math.round(seconds)), timerRunning: true };
}

/** A topic back to To Discuss (Undo of a start), the timer stopped. */
export function withTopicBack(board: BoardState, topicId: string): BoardState {
  if (!board.cards.some((c) => c.id === topicId)) return board;
  return {
    ...board,
    cards: moved(board.cards, topicId, LEAN_COFFEE_COLUMNS.todo, false),
    timerRunning: false,
  };
}

export type ThumbsDecision = "keep" | "move" | "tie" | "none";

/** What the thumbs say: more up keeps going, more down moves on. */
export function thumbsDecision(tally: { keep: number; move: number }): ThumbsDecision {
  if (tally.keep === 0 && tally.move === 0) return "none";
  if (tally.keep === tally.move) return "tie";
  return tally.keep > tally.move ? "keep" : "move";
}

/** A whole number of minutes from a choice list, or the default. */
export function minutesIn(value: unknown, choices: readonly number[], fallback: number): number {
  return typeof value === "number" && choices.includes(value) ? value : fallback;
}

/**
 * Merging a group of topics (the host accepts a suggestion): every topic in
 * `ids` but the most-voted one goes under that one, in its column. Cards
 * that were grouped under a merged topic move up to the new top card too,
 * so grouping stays one level deep. Returns the board unchanged when fewer
 * than two of the ids are topics.
 */
export function withTopicsMerged(board: BoardState, ids: readonly string[]): BoardState {
  const topics = leanTopics(board.cards).filter((t) => ids.includes(t.id));
  if (topics.length < 2) return board;
  const [top] = [...topics].sort(byVotes);
  const merged = new Set(topics.filter((t) => t.id !== top.id).map((t) => t.id));
  return {
    ...board,
    cards: board.cards.map((c) => {
      if (merged.has(c.id) || (c.groupedWith !== null && merged.has(c.groupedWith))) {
        return { ...c, groupedWith: top.id, columnKey: top.columnKey, discussing: false };
      }
      return c;
    }),
  };
}
