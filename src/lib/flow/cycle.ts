/**
 * Cycle time: how long finished work took, and how old the work still in
 * progress is. One day convention for every tool and agent action: whole
 * local calendar days with the start day and the finish day both counted,
 * so an item started and finished on the same day took 1 day, not a made-up
 * 0. The Flow board (lib/kanban/flow cycleStats), Cycle Time, the Health
 * Dashboard and DORA lead time all count this way, so they quote one P85.
 */

import { percentile } from "@/lib/sprints/metrics";
import { localDay } from "@/lib/sprints/series";
import { dayNumber } from "./days";
import { stageKind } from "./workflows";
import type { FlowItem } from "./types";

/**
 * Whole local calendar days from `start` to `end`, both counted: a same-day
 * item is 1. Null when either is missing or not a date, or `end` comes
 * before `start`. Days are local because stamps are UTC timestamps: an
 * evening's finish east of UTC would otherwise land on the next day.
 */
export function cycleDays(
  start: string | null | undefined,
  end: string | null | undefined
): number | null {
  const a = dayNumber(start);
  const b = dayNumber(end);
  if (a === null || b === null || b < a) return null;
  return b - a + 1;
}

/** A finished item with its cycle time. "typed" is Cycle Time's own typed item. */
export interface FinishedItem {
  id: string;
  title: string;
  kind: "story" | "card" | "typed";
  /** Local "YYYY-MM-DD". */
  startedOn: string;
  /** Local "YYYY-MM-DD". */
  doneOn: string;
  /** `cycleDays(startedOn, doneOn)`. */
  days: number;
}

/**
 * The items finished (in done, with a done day) that have a start too,
 * oldest finish first, optionally only those done from `range.from` to
 * `range.to` (both included). An item without a start, such as a card
 * dropped straight into Done, has no cycle time rather than a made-up one;
 * it still counts as throughput (pass the FlowItems to ./throughput).
 */
export function finishedItems(
  items: readonly FlowItem[],
  range: { from?: string; to?: string } = {}
): FinishedItem[] {
  const from = range.from ? dayNumber(range.from) : null;
  const to = range.to ? dayNumber(range.to) : null;
  const out: FinishedItem[] = [];
  for (const item of items) {
    const days = cycleDays(item.startedOn, item.doneOn);
    if (days === null || !item.startedOn || !item.doneOn) continue;
    const done = dayNumber(item.doneOn) as number;
    if ((from !== null && done < from) || (to !== null && done > to)) continue;
    out.push({
      id: item.id,
      title: item.title,
      kind: item.kind,
      startedOn: localDay(item.startedOn) as string,
      doneOn: localDay(item.doneOn) as string,
      days,
    });
  }
  // Stable: items done on the same day keep the order they came in.
  return out.sort((a, b) => (a.doneOn < b.doneOn ? -1 : a.doneOn > b.doneOn ? 1 : 0));
}

/**
 * Cycle-time statistics over some days. The values are raw: callers quote
 * the average from MIN_SAMPLE.average items and the median, percentiles and
 * spread from MIN_SAMPLE.distribution (lib/analytics/min-sample), showing
 * NotEnoughData below that, as lib/kanban/flow CycleStats documents.
 */
export interface CycleSummary {
  count: number;
  /** Mean days; null without any. */
  average: number | null;
  /** 50% finished within this many days (nearest rank, like the percentiles). */
  median: number | null;
  /** 85% finished within this many days: the usual service-level expectation. */
  p85: number | null;
  p95: number | null;
  /** Population standard deviation in days. */
  spread: number | null;
}

/**
 * Count, mean, nearest-rank percentiles (the shared lib/sprints/metrics
 * `percentile`, so the page and the agent agree to the day) and the
 * population spread of `days`. Values that aren't finite numbers are left out.
 */
export function cycleSummary(days: readonly number[]): CycleSummary {
  const xs = days.filter((d) => Number.isFinite(d));
  const count = xs.length;
  if (count === 0) {
    return { count, average: null, median: null, p85: null, p95: null, spread: null };
  }
  const average = xs.reduce((a, b) => a + b, 0) / count;
  const variance = xs.reduce((sum, d) => sum + (d - average) ** 2, 0) / count;
  return {
    count,
    average,
    median: percentile(xs, 50),
    p85: percentile(xs, 85),
    p95: percentile(xs, 95),
    spread: Math.sqrt(variance),
  };
}

/** An item in progress and how long it has been worked on. */
export interface AgeingItem {
  id: string;
  title: string;
  kind: "story" | "card";
  stage: string;
  /** Local "YYYY-MM-DD" work started (else the day it entered its stage). */
  startedOn: string;
  /** Days in work, counted like a cycle time: the start day is 1. */
  ageDays: number;
  /** Older than the finished items' P85; null without a P85 to compare with. */
  overP85: boolean | null;
  blocked: boolean;
  owner?: string;
}

/** The day the item entered its current stage, from its last move there, else its arrival. */
function enteredOn(item: FlowItem): string | null {
  const last = item.moves[item.moves.length - 1];
  if (last && last.to === item.stage && localDay(last.at)) return localDay(last.at);
  return localDay(item.arrivedOn);
}

/**
 * The items in an active stage (In progress, Review) on `today`, oldest
 * first, each with its age counted like a cycle time, so an item still in
 * progress after more days than the P85 reads as at risk of missing it.
 * Pass a P85 only once it may be quoted (MIN_SAMPLE.distribution finished
 * items), else null, and `overP85` stays null. An item with no start falls
 * back to the day it entered its stage. A story that has left the sprint it
 * was read for (`leftOn`) isn't that sprint's work in progress any more.
 */
export function ageingWip(
  items: readonly FlowItem[],
  today: string,
  p85: number | null
): AgeingItem[] {
  if (dayNumber(today) === null) return [];
  const limit = p85 !== null && Number.isFinite(p85) ? p85 : null;
  const out: AgeingItem[] = [];
  for (const item of items) {
    if (stageKind(item) !== "active" || item.leftOn) continue;
    const startedOn = localDay(item.startedOn) ?? enteredOn(item);
    if (!startedOn) continue;
    // A start dated after today (another device's clock) has just started.
    const ageDays = cycleDays(startedOn, today) ?? 1;
    out.push({
      id: item.id,
      title: item.title,
      kind: item.kind,
      stage: item.stage,
      startedOn,
      ageDays,
      overP85: limit === null ? null : ageDays > limit,
      blocked: item.blocked,
      ...(item.owner ? { owner: item.owner } : {}),
    });
  }
  return out.sort((a, b) => b.ageDays - a.ageDays);
}
