/**
 * Throughput (items finished per day or per ISO week), Little's Law, recent
 * board activity and DORA's lead time, over local days like the rest of
 * lib/flow. The weekly series and `isoWeek` moved here from the Kanban
 * page (kanban/flow-view keeps its card-based wrappers), so the Flow board,
 * Cycle Time's trend and the agents count weeks the same way.
 *
 * The throughput helpers take anything with a `doneOn`: pass FlowItems to
 * count everything finished (a card dropped straight into Done too), or
 * FinishedItems (./cycle) to count only the work with a cycle time.
 */

import { isoFromDayNumber } from "@/lib/sprints/calendar";
import { localDay } from "@/lib/sprints/series";
import { cycleDays } from "./cycle";
import { dayNumber, dayRange } from "./days";
import type { FlowItem } from "./types";

const DAY_MS = 86_400_000;

/** A finished item for counting: its local done day (null: not finished). */
type Done = { doneOn: string | null };

export interface ThroughputPoint {
  /** The day ("2026-10-20") or the ISO week ("2026-W42"). */
  label: string;
  value: number;
}

/** The ISO-8601 week of a UTC day number, with the year of its Thursday. */
function isoWeekOfDayNumber(n: number): { year: number; week: number } {
  const date = new Date(n * DAY_MS);
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / DAY_MS + 1) / 7);
  return { year: date.getUTCFullYear(), week };
}

/**
 * ISO-8601 week number of `d`'s local calendar day, with the year of the
 * Thursday-anchored week. Avoids the year/DST boundary glitch of raw
 * `floor((d - Jan1) / 7days)` keys, which miscount weeks at year boundaries
 * and split one calendar week across two buckets when DST shifts the
 * millisecond delta.
 */
export function isoWeek(d: Date): { year: number; week: number } {
  return isoWeekOfDayNumber(
    Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS)
  );
}

const weekLabel = (n: number) => {
  const { year, week } = isoWeekOfDayNumber(n);
  return `${year}-W${String(week).padStart(2, "0")}`;
};

/** The ISO week label ("2026-W42") of a local day or timestamp, or null when it isn't one. */
export function weekOf(day: string | null | undefined): string | null {
  const n = dayNumber(day);
  return n === null ? null : weekLabel(n);
}

/** Items finished on each day from `range.from` to `range.to` (both included), quiet days as 0. */
export function throughputByDay(
  finished: readonly Done[],
  range: { from: string; to: string }
): ThroughputPoint[] {
  const byDay = new Map<string, number>();
  for (const f of finished) {
    const day = localDay(f.doneOn);
    if (day) byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  return dayRange(range.from, range.to).map((label) => ({ label, value: byDay.get(label) ?? 0 }));
}

/**
 * Items finished per ISO week, from the first finish's week to the last,
 * with the empty weeks in between as 0. The control limits, change points,
 * trend test and forecast all read the series as consecutive weeks: listing
 * only weeks with a finish made a stalled team (5 done, four silent weeks,
 * 5 done) read as a flat, in-control [5, 5].
 */
export function throughputByWeek(finished: readonly Done[]): ThroughputPoint[] {
  const byWeek = new Map<string, number>();
  let min = Infinity;
  let max = -Infinity;
  for (const f of finished) {
    const n = dayNumber(f.doneOn);
    if (n === null) continue;
    min = Math.min(min, n);
    max = Math.max(max, n);
    const key = weekLabel(n);
    byWeek.set(key, (byWeek.get(key) ?? 0) + 1);
  }
  if (byWeek.size === 0) return [];
  const lastKey = weekLabel(max);
  const out: ThroughputPoint[] = [];
  // Day numbers step whole days, so no DST shift can skip or repeat a week.
  // A 1000-week cap keeps a corrupt far-past date from looping for long.
  for (let n = min; out.length < 1000; n += 7) {
    const key = weekLabel(n);
    out.push({ label: key, value: byWeek.get(key) ?? 0 });
    if (key === lastKey) break;
  }
  return out;
}

/** Items finished in the 7 local days up to and including `today`. */
export function throughputLastWeek(finished: readonly Done[], today: string): number {
  const end = dayNumber(today);
  if (end === null) return 0;
  return finished.filter((f) => {
    const n = dayNumber(f.doneOn);
    return n !== null && n > end - 7 && n <= end;
  }).length;
}

/** Little's Law over a stretch of days: average lead time = average WIP ÷ throughput. */
export interface LittlesLaw {
  /** Days elapsed from the first point's date to the last's. */
  days: number;
  /** The mean WIP over the points. */
  avgWip: number;
  /** Items finished per elapsed day. */
  throughputPerDay: number;
  /** About how many days an item takes from start to done. */
  leadTimeDays: number;
}

/**
 * Little's Law from dated WIP and cumulative-done points (in any order).
 * Throughput is the rise in done over the days elapsed between the first
 * and the last date, not the number of points: typed snapshots taken on
 * uneven dates (1, 2 and 30 October) would otherwise read 29 days as 2.
 * WIP is the mean of the points (one per day for a board source). Null with
 * fewer than 2 distinct dates or no throughput (done flat or falling), when
 * the law says nothing.
 */
export function littlesLaw(
  points: readonly { date: string; wip: number; done: number }[]
): LittlesLaw | null {
  const dated = points
    .map((p) => ({ n: dayNumber(p.date), wip: p.wip, done: p.done }))
    .filter(
      (p): p is { n: number; wip: number; done: number } =>
        p.n !== null && Number.isFinite(p.wip) && Number.isFinite(p.done)
    )
    .sort((a, b) => a.n - b.n);
  if (dated.length < 2) return null;
  const first = dated[0];
  const last = dated[dated.length - 1];
  const days = last.n - first.n;
  if (days <= 0) return null;
  const throughputPerDay = (last.done - first.done) / days;
  if (!(throughputPerDay > 0)) return null;
  const avgWip = dated.reduce((sum, p) => sum + p.wip, 0) / dated.length;
  return { days, avgWip, throughputPerDay, leadTimeDays: avgWip / throughputPerDay };
}

/**
 * How many distinct items moved on their board in the `days` local days up
 * to and including `today` (default a week): Value Stream's cue that the
 * stage times it was given may no longer match how work flows.
 */
export function recentMoves(items: readonly FlowItem[], today: string, days = 7): number {
  const end = dayNumber(today);
  if (end === null || !(days >= 1)) return 0;
  const start = end - Math.floor(days) + 1;
  return items.filter((item) =>
    item.moves.some((m) => {
      const n = dayNumber(m.at);
      return n !== null && n >= start && n <= end;
    })
  ).length;
}

/**
 * Lead time in hours for DORA: from the start day to the done day, or to
 * `shippedOn` (the release it went out in) when that is on or after the
 * done day, counted in whole days like a cycle time (a same-day item is
 * 24 hours). Null without both a start and a done day.
 */
export function leadTimeHours(
  item: Pick<FlowItem, "startedOn" | "doneOn">,
  shippedOn?: string | null
): number | null {
  const done = dayNumber(item.doneOn);
  if (done === null) return null;
  const shipped = dayNumber(shippedOn);
  const end = shipped !== null && shipped >= done ? isoFromDayNumber(shipped) : item.doneOn;
  const days = cycleDays(item.startedOn, end);
  return days === null ? null : days * 24;
}
