/**
 * Estimate without a meeting (Planning Poker): the small, dependency-free
 * part of a round's life that the Poker page and its next step need before
 * the rest of the feature loads.
 *
 * - The queue hold: the stories of open and revealed rounds stay out of a
 *   session's queue (lib/handoffs/poker-writeback `held`).
 * - Names and notes don't stay: closing a round drops them and keeps the
 *   votes. A round nobody closes is closed the same way `keepDays` (14)
 *   days after its due date, or after the day it was made without one.
 *   Every read goes through `readAsyncRound`, so an expired round never
 *   shows a name, and the page writes the dropped copy when it loads.
 * - The next step: a round to reveal.
 *
 * Pure and server-safe: types, the caps and the example-id test only. The
 * codes and results live in ./async-pack, which re-exports all of this.
 */

import { POKER_ASYNC_MAX, type PokerAsyncRound } from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";

/** Every round's id starts with this. */
export const ASYNC_ROUND_PREFIX = "async_";

/** Where a round's estimators open their link. */
export const ESTIMATE_PATH = "/planning-poker/estimate";

/**
 * The story ids open and revealed rounds hold: the queue items stamped with
 * them stay put until the round is closed or deleted.
 */
export function heldStoryIds(rounds: readonly PokerAsyncRound[] | undefined): string[] {
  const ids: string[] = [];
  for (const round of rounds ?? []) {
    if (round.status === "closed") continue;
    for (const story of round.stories) ids.push(story.id);
  }
  return ids;
}

/**
 * How many of the queue's items an open or revealed round holds (stamped
 * with one of its story ids), with each round read as `readAsyncRound`
 * shows it: the "N in an async round" that Planning Poker's lobby and the
 * Estimation Guide show, as no session can take those items.
 */
export function heldQueueCount(
  queue: readonly { sessionStoryId?: string }[] | undefined,
  rounds: readonly PokerAsyncRound[] | undefined,
  now: Date = new Date()
): number {
  const held = new Set(heldStoryIds((rounds ?? []).map((r) => readAsyncRound(r, now))));
  return (queue ?? []).filter((q) => q.sessionStoryId !== undefined && held.has(q.sessionStoryId))
    .length;
}

/** `day` ("YYYY-MM-DD") plus `n` days, as a day. */
export function addDaysIso(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/**
 * How far ahead a round can be due, in days. Names and notes stay until 14
 * days after the due day, so this keeps that promise bounded.
 */
export const DUE_MAX_DAYS = 90;

/** The latest due day a round made on `today` ("YYYY-MM-DD") can have. */
export function latestDueDay(today: string): string {
  return addDaysIso(today, DUE_MAX_DAYS);
}

/** The last day a round keeps its names and notes. */
export function keepUntil(round: Pick<PokerAsyncRound, "dueDate" | "createdAt">): string {
  const from = round.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(round.dueDate) ? round.dueDate : "";
  return addDaysIso(from || round.createdAt.slice(0, 10), POKER_ASYNC_MAX.keepDays);
}

/** Whether a round that is still open or revealed has passed `keepUntil`. */
export function isExpired(round: PokerAsyncRound, today: string): boolean {
  return round.status !== "closed" && today > keepUntil(round);
}

/** `round` without anyone's name or notes: the votes stay, unnamed. */
export function withoutNames(round: PokerAsyncRound): PokerAsyncRound {
  const next: PokerAsyncRound = {
    ...round,
    replies: round.replies.map((reply) => ({
      id: reply.id,
      name: "",
      votes: reply.votes,
      at: reply.at,
    })),
  };
  delete next.expected;
  return next;
}

/** Whether `round` still holds a name or a note. */
export function hasNames(round: PokerAsyncRound): boolean {
  return (
    (round.expected?.length ?? 0) > 0 ||
    round.replies.some((r) => r.name !== "" || (r.notes?.length ?? 0) > 0)
  );
}

/** The host shows everyone's cards. */
export function revealRound(round: PokerAsyncRound, now: string): PokerAsyncRound {
  if (round.status !== "open") return round;
  return { ...round, status: "revealed", revealedAt: now, updatedAt: now };
}

/** Closed: no more replies, and the names and notes are dropped. */
export function closeRound(round: PokerAsyncRound, now: string): PokerAsyncRound {
  const closed = withoutNames(round);
  return { ...closed, status: "closed", closedAt: round.closedAt ?? now, updatedAt: now };
}

/** Closed if it has passed `keepUntil` (`today` is the local day); else `round` itself. */
export function expireRound(round: PokerAsyncRound, now: string, today: string): PokerAsyncRound {
  return isExpired(round, today) ? closeRound(round, now) : round;
}

/**
 * A round as every reader shows it: an expired round closed, with no name
 * or note. The same object when nothing changes.
 */
export function readAsyncRound(round: PokerAsyncRound, now: Date = new Date()): PokerAsyncRound {
  return expireRound(round, now.toISOString(), localDay(now));
}

/** The local calendar day of `now`, as todayIso does. */
function localDay(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** `round` with `value` agreed for story `storyId` (unchanged if it isn't there). */
export function withStoryEstimate(
  round: PokerAsyncRound,
  storyId: string,
  value: string | undefined,
  now: string
): PokerAsyncRound {
  if (!round.stories.some((s) => s.id === storyId)) return round;
  return {
    ...round,
    updatedAt: now,
    stories: round.stories.map((s) => {
      if (s.id !== storyId) return s;
      if (value !== undefined) return { ...s, finalEstimate: value, discuss: false };
      const rest = { ...s };
      delete rest.finalEstimate;
      return rest;
    }),
  };
}

/** How many of the round's expected people have replied (by name, any case). */
export function expectedReplied(round: PokerAsyncRound): { replied: number; expected: number } {
  const expected = round.expected ?? [];
  const names = new Set(round.replies.map((r) => r.name.trim().toLowerCase()));
  const replied = expected.filter((n) => names.has(n.trim().toLowerCase())).length;
  return { replied, expected: expected.length };
}

/**
 * An open round worth revealing: someone replied, and its due day has
 * passed or everyone it expects has replied. Example rounds never are.
 */
export function isReadyToReveal(round: PokerAsyncRound, today: string): boolean {
  if (round.status !== "open" || isExampleId(round.id) || round.replies.length === 0) return false;
  if (isExpired(round, today)) return false;
  const due = Boolean(round.dueDate) && today > (round.dueDate as string);
  const { replied, expected } = expectedReplied(round);
  return due || (expected > 0 && replied === expected);
}

/** One step, in the shape lib/tools/next-steps `NextStep` takes. */
export interface AsyncRevealStep {
  id: string;
  label: string;
  detail?: string;
  href: string;
}

/** A short title for a step's label. */
function shortTitle(title: string, max = 40): string {
  const t = title.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * Planning Poker's next step for each round ready to reveal (at most two):
 * "Reveal “X”: N of M replied".
 */
export function asyncRevealSteps(
  rounds: readonly PokerAsyncRound[] | undefined,
  today: string
): AsyncRevealStep[] {
  return (rounds ?? [])
    .filter((r) => isReadyToReveal(r, today))
    .slice(0, 2)
    .map((r) => {
      const { replied, expected } = expectedReplied(r);
      const n = r.replies.length;
      const count = expected > 0 ? `${replied} of ${expected} replied` : `${n} replied`;
      const everyone = expected > 0 && replied === expected;
      return {
        id: `poker-async-reveal-${r.id}`,
        label: `Reveal “${shortTitle(r.title)}”: ${count}`,
        detail: everyone
          ? "Everyone you expected has sent their cards."
          : "Its due day has passed. Reveal the cards you have.",
        href: "/planning-poker",
      };
    });
}
