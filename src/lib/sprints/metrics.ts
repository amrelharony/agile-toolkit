/**
 * The sprint metrics every tool should agree on, in one place:
 *
 *   - `velocity`      mean completed points of the latest finished sprints,
 *                     latest by end date (never the order they were stored);
 *   - `predictability` how often the latest pointed sprints met their
 *                     commitment, from the graded say/do;
 *   - `sayDoRatio`    completed vs committed, graded rather than pass/fail;
 *   - `projectFinish` where a least-squares trend reaches a target;
 *   - `percentile`    one method (nearest rank);
 *   - `completionPct` done as a share of the current scope;
 *   - `gap`           remaining minus ideal: positive means behind.
 *
 * `sprintStatus` builds the Sprint Metrics hub's and the Sprint Cockpit's
 * numbers for one sprint from them. Its burndown and burnup figures match the
 * `tool.burndown.compute` and `tool.burnup.compute` MCP actions (a parity
 * test keeps them equal) on the calendar-day convention the tools chart: day
 * 0 is the start date and the ideal line reaches 0 on the last day. Given a
 * working calendar, the ideal line and the projection count working days.
 *
 * Days in between logged days count as "no change" (the previous reading
 * carries forward), so a missed day doesn't read as a sudden drop.
 */

import type { Sprint, SprintSeries } from "@/lib/stores/workspace-types";
import { isoDayNumber, type WorkingCalendar } from "./calendar";
import {
  averageRating,
  completedAt,
  dayForWorkingDay,
  elapsedWorkingDays,
  idealRemainingAt,
  lastLoggedDay,
  loggedDayCount,
  remainingAt,
  scopeAt,
  sprintLengthDays,
  sprintWorkingDays,
} from "./series";

const round1 = (n: number) => Math.round(n * 10) / 10;

/* ── Trend lines ─────────────────────────────────────────────────────── */

export interface Point {
  x: number;
  y: number;
}

/** Least-squares fit of points. Fewer than two, or all at one x: a flat line through the mean. */
export function fitPoints(points: readonly Point[]): { slope: number; intercept: number } {
  const n = points.length;
  if (n === 0) return { slope: 0, intercept: 0 };
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (const { x, y } of points) {
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const denom = n * sumXX - sumX * sumX;
  if (n < 2 || denom === 0) return { slope: 0, intercept: sumY / n };
  const slope = (n * sumXY - sumX * sumY) / denom;
  return { slope, intercept: (sumY - slope * sumX) / n };
}

/** Least-squares fit of ys against x = 0..n-1 (the MCP compute actions' fit). */
export function fitLine(ys: readonly number[]): { slope: number; intercept: number } {
  if (ys.length < 2) return { slope: 0, intercept: ys[0] ?? 0 };
  return fitPoints(ys.map((y, x) => ({ x, y })));
}

function toPoints(values: readonly number[] | readonly Point[]): Point[] {
  const points = (values as readonly (number | Point)[]).map((v, i) =>
    typeof v === "number" ? { x: i, y: v } : v
  );
  return points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

/**
 * The x at which the least-squares trend of `values` reaches `target`
 * (default 0: points left running out), to one decimal. A plain array is
 * read as one value per day from x = 0. Already there (the latest value has
 * reached the target): the latest x. Null with fewer than two points, a flat
 * trend, or a trend heading away from the target.
 */
export function projectFinish(
  values: readonly number[] | readonly Point[],
  { target = 0 }: { target?: number } = {}
): number | null {
  const points = toPoints(values);
  if (points.length < 2) return null;
  const first = points[0].y;
  const last = points[points.length - 1];
  const down = first > target;
  if (down ? last.y <= target : first < target ? last.y >= target : last.y === target) {
    return last.x;
  }
  const { slope, intercept } = fitPoints(points);
  if (slope === 0 || !Number.isFinite(slope)) return null;
  if (first === target || (down ? slope > 0 : slope < 0)) return null;
  return round1((target - intercept) / slope);
}

/* ── Single numbers ──────────────────────────────────────────────────── */

/**
 * The p-th percentile (0–100) by nearest rank: the smallest value with at
 * least p% of the values at or below it, so "85% finish within N days"
 * holds for the data. Unsorted input is fine; non-numbers are ignored and p
 * is clamped to 0–100. Null when there are no values or p isn't a number.
 */
export function percentile(values: readonly number[], p: number): number | null {
  if (!Number.isFinite(p)) return null;
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const pct = Math.min(100, Math.max(0, p));
  const rank = Math.ceil((pct / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

/** Done as a whole percentage (0–100) of the current scope; null without a scope. */
export function completionPct(done: number, scope: number): number | null {
  if (!Number.isFinite(done) || !Number.isFinite(scope) || scope <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((done / scope) * 100)));
}

/** Remaining minus ideal remaining, to one decimal: positive is behind, negative ahead. */
export function gap(remaining: number, idealRemaining: number): number {
  const g = round1(remaining - idealRemaining);
  return Object.is(g, -0) ? 0 : g;
}

/** "Behind by 3 points", "Ahead by 1.5 points" or "On the ideal line". */
export function gapLabel(value: number, unit: { one: string; many: string } = POINTS): string {
  const n = Math.abs(round1(value));
  if (n === 0) return "On the ideal line";
  return `${value > 0 ? "Behind" : "Ahead"} by ${n} ${n === 1 ? unit.one : unit.many}`;
}

const POINTS = { one: "point", many: "points" };

/* ── Say/do ──────────────────────────────────────────────────────────── */

/**
 * How a sprint's delivery compares with its commitment:
 *   met    90–110% of the commitment;
 *   close  70% up to 90%;
 *   missed under 70%;
 *   over   over 110% (the team said less than it could do).
 */
export type SayDoGrade = "met" | "close" | "missed" | "over";

export const SAY_DO_GRADE_LABEL: Record<SayDoGrade, string> = {
  met: "Met the commitment",
  close: "Close to the commitment",
  missed: "Missed the commitment",
  over: "Did more than committed",
};

export interface SayDo {
  /** Completed ÷ committed. */
  ratio: number;
  /** The ratio as a whole percentage. */
  pct: number;
  grade: SayDoGrade;
  /** 0–1, how close delivery came to the commitment either way (1 = exactly). */
  score: number;
}

/** Say/do for one sprint; null without a positive commitment or a completed number. */
export function sayDoRatio(committed: number, completed: number | null | undefined): SayDo | null {
  if (!Number.isFinite(committed) || committed <= 0) return null;
  if (typeof completed !== "number" || !Number.isFinite(completed)) return null;
  const ratio = Math.max(0, completed) / committed;
  const grade: SayDoGrade =
    ratio > 1.1 ? "over" : ratio >= 0.9 ? "met" : ratio >= 0.7 ? "close" : "missed";
  return {
    ratio,
    pct: Math.round(ratio * 100),
    grade,
    score: Math.max(0, Math.min(1, 1 - Math.abs(1 - ratio))),
  };
}

/* ── Velocity ────────────────────────────────────────────────────────── */

/** How many finished sprints a velocity averages unless told otherwise. */
export const DEFAULT_VELOCITY_WINDOW = 3;

export interface VelocityOptions {
  /** How many of the latest finished sprints to average (default 3; Infinity for all). */
  window?: number;
  /** Which date orders the sprints (default the end date). */
  by?: "endDate" | "startDate";
}

export interface Velocity {
  /** Mean completed points, to one decimal; null when no sprint qualifies. */
  average: number | null;
  /** How many sprints went into it. */
  count: number;
  /** Their completed points, oldest first. */
  points: number[];
  /** Their ids, oldest first. */
  sprintIds: string[];
}

function sortDay(s: Sprint, by: "endDate" | "startDate"): number {
  const primary = by === "endDate" ? s.endDate : s.startDate;
  const fallback = by === "endDate" ? s.startDate : s.endDate;
  return isoDayNumber(primary) ?? isoDayNumber(fallback) ?? Number.NEGATIVE_INFINITY;
}

/**
 * Sprints oldest first by `by` (the end date unless told otherwise): the
 * order velocity, trends and charts share. Undated sprints count as the
 * oldest; ties keep their stored order.
 */
export function sprintsByEndDate<T extends Sprint>(
  sprints: readonly T[],
  by: "endDate" | "startDate" = "endDate"
): T[] {
  return sprints
    .map((s, i) => ({ s, i, day: sortDay(s, by) }))
    .sort((a, b) => (a.day === b.day ? a.i - b.i : a.day - b.day))
    .map(({ s }) => s);
}

/** A finished sprint with a completed number: one velocity counts. */
function isFinished(s: Sprint): boolean {
  return (
    s.status === "completed" &&
    typeof s.pointsCompleted === "number" &&
    Number.isFinite(s.pointsCompleted)
  );
}

/**
 * A finished sprint the team pointed: a positive commitment and a completed
 * number. A sprint closed with 0 committed points (a team that doesn't
 * estimate, or a placeholder) would read as 0% predictable or skew a
 * per-person rate, so trends and the health dashboard leave it out.
 */
export function isPointedSprint(s: Sprint): boolean {
  return isFinished(s) && Number.isFinite(s.pointsPlanned) && s.pointsPlanned > 0;
}

function windowOf(requested: number | undefined, fallback: number): number {
  if (requested === Number.POSITIVE_INFINITY) return requested;
  return typeof requested === "number" && Number.isFinite(requested) && requested >= 1
    ? Math.floor(requested)
    : fallback;
}

/**
 * Velocity over the latest `window` completed sprints that have completed
 * points, latest by `by` (undated sprints count as the oldest; ties keep
 * their stored order).
 */
export function velocity(sprints: readonly Sprint[], options: VelocityOptions = {}): Velocity {
  const { window: requested = DEFAULT_VELOCITY_WINDOW, by = "endDate" } = options;
  const window = windowOf(requested, DEFAULT_VELOCITY_WINDOW);
  const finished = sprintsByEndDate(sprints.filter(isFinished), by);
  const used = window === Number.POSITIVE_INFINITY ? finished : finished.slice(-window);
  const points = used.map((s) => s.pointsCompleted as number);
  return {
    average: points.length === 0 ? null : round1(points.reduce((a, b) => a + b, 0) / points.length),
    count: points.length,
    points,
    sprintIds: used.map((s) => s.id),
  };
}

/**
 * The velocity as it stood after each finished sprint, oldest first: the
 * mean of that sprint and the `window - 1` finished before it (fewer at the
 * start). For a rolling-average line on a velocity chart.
 */
export function rollingVelocity(
  sprints: readonly Sprint[],
  window: number = DEFAULT_VELOCITY_WINDOW,
  by: "endDate" | "startDate" = "endDate"
): { sprintId: string; average: number }[] {
  const w = windowOf(window, DEFAULT_VELOCITY_WINDOW);
  const finished = sprintsByEndDate(sprints.filter(isFinished), by);
  return finished.map((s, i) => {
    const used = finished.slice(w === Number.POSITIVE_INFINITY ? 0 : Math.max(0, i - w + 1), i + 1);
    const sum = used.reduce((a, x) => a + (x.pointsCompleted as number), 0);
    return { sprintId: s.id, average: round1(sum / used.length) };
  });
}

/* ── Predictability ──────────────────────────────────────────────────── */

/** How many pointed sprints predictability looks at unless told otherwise. */
export const DEFAULT_PREDICTABILITY_WINDOW = 6;

export interface SprintSayDo extends SayDo {
  sprintId: string;
  name: string;
  endDate: string;
}

export interface Predictability {
  /** % of the window's pointed sprints that met their commitment (90–110%); null with none. */
  pct: number | null;
  /** Mean say/do % across them; null with none. */
  meanSayDoPct: number | null;
  /** Pointed sprints it looked at. */
  count: number;
  byGrade: Record<SayDoGrade, number>;
  /** The sprints, oldest first by end date. */
  sprints: SprintSayDo[];
}

/**
 * How predictable the team is: of the latest `window` pointed sprints
 * (default 6), how many met their commitment, with the graded say/do of
 * each. Unpointed sprints are left out (see `isPointedSprint`). Quote a
 * trend in it only from MIN_SAMPLE.trend sprints.
 */
export function predictability(
  sprints: readonly Sprint[],
  { window, by = "endDate" }: { window?: number; by?: "endDate" | "startDate" } = {}
): Predictability {
  const w = windowOf(window, DEFAULT_PREDICTABILITY_WINDOW);
  const pointed = sprintsByEndDate(sprints.filter(isPointedSprint), by);
  const used = w === Number.POSITIVE_INFINITY ? pointed : pointed.slice(-w);
  const byGrade: Record<SayDoGrade, number> = { met: 0, close: 0, missed: 0, over: 0 };
  const rows: SprintSayDo[] = [];
  for (const s of used) {
    const sd = sayDoRatio(s.pointsPlanned, s.pointsCompleted);
    if (!sd) continue;
    byGrade[sd.grade]++;
    rows.push({ ...sd, sprintId: s.id, name: s.name, endDate: s.endDate });
  }
  const count = rows.length;
  return {
    pct: count === 0 ? null : Math.round((byGrade.met / count) * 100),
    meanSayDoPct: count === 0 ? null : Math.round(rows.reduce((a, r) => a + r.pct, 0) / count),
    count,
    byGrade,
    sprints: rows,
  };
}

/* ── One sprint's status ─────────────────────────────────────────────── */

/**
 * Remaining, completed and scope for days 0..last logged day, carrying the
 * previous reading over days with no entry. Empty when nothing is logged.
 */
export function denseSeries(
  sprint: Pick<Sprint, "pointsPlanned">,
  series: SprintSeries | undefined
): { remaining: number[]; completed: number[]; scope: number[] } {
  const last = lastLoggedDay(series);
  const out = { remaining: [] as number[], completed: [] as number[], scope: [] as number[] };
  if (last === null) return out;
  let rem: number = sprint.pointsPlanned;
  let done = 0;
  for (let day = 0; day <= last; day++) {
    const r = remainingAt(sprint, series, day);
    const c = completedAt(sprint, series, day);
    if (r !== null) rem = r;
    if (c !== null) done = c;
    out.remaining.push(rem);
    out.completed.push(done);
    out.scope.push(scopeAt(sprint, series, day));
  }
  return out;
}

export interface SprintStatus {
  /** Days from start to end; the ideal line reaches 0 on this day. */
  lengthDays: number;
  /** Last day with a reading, or null when nothing is logged yet. */
  lastDay: number | null;
  loggedDays: number;
  committed: number;
  scopeNow: number;
  /** Scope now minus the plan (positive: scope was added). */
  scopeChange: number;
  done: number | null;
  remaining: number | null;
  percentDone: number | null;
  /** Where the ideal line is on the last logged day. */
  idealRemaining: number | null;
  /** Remaining minus ideal (positive: behind). */
  gap: number | null;
  onTrack: boolean | null;
  /** Day the remaining trend reaches 0, or null if it isn't going down. */
  projectedFinishDay: number | null;
  willFinishOnTime: boolean | null;
  averageRating: number | null;
}

export interface SprintStatusOptions {
  /** Count the ideal line and the projection in working days. */
  calendar?: WorkingCalendar;
}

/** The hub's numbers for one sprint. */
export function sprintStatus(
  sprint: Sprint,
  series: SprintSeries | undefined,
  { calendar }: SprintStatusOptions = {}
): SprintStatus {
  const lengthDays = sprintLengthDays(sprint);
  const dense = denseSeries(sprint, series);
  const lastDay = dense.remaining.length > 0 ? dense.remaining.length - 1 : null;
  const committed = sprint.pointsPlanned;
  const scopeNow = lastDay === null ? committed : dense.scope[lastDay];

  let idealRemaining: number | null = null;
  let behind: number | null = null;
  let projectedFinishDay: number | null = null;
  let willFinishOnTime: boolean | null = null;
  let remaining: number | null = null;
  let done: number | null = null;
  if (lastDay !== null) {
    remaining = dense.remaining[lastDay];
    done = dense.completed[lastDay];
    // tool.burndown.compute with sprintDays = lengthDays + 1: the ideal line
    // runs from the plan on day 0 to 0 on day lengthDays.
    idealRemaining = idealRemainingAt(sprint, committed, lastDay, calendar);
    behind = gap(remaining, idealRemaining);
    const finish = projectFinish(
      dense.remaining.map((y, d) => ({ x: elapsedWorkingDays(sprint, d, calendar), y }))
    );
    if (finish !== null) {
      projectedFinishDay = calendar ? dayForWorkingDay(sprint, finish, calendar) : finish;
      willFinishOnTime = finish <= sprintWorkingDays(sprint, calendar);
    }
  }

  return {
    lengthDays,
    lastDay,
    loggedDays: loggedDayCount(series),
    committed,
    scopeNow,
    scopeChange: round1(scopeNow - committed),
    done,
    remaining,
    percentDone: done === null ? null : completionPct(done, scopeNow),
    idealRemaining: idealRemaining === null ? null : round1(idealRemaining),
    gap: behind,
    onTrack: behind === null ? null : behind <= 0,
    projectedFinishDay,
    willFinishOnTime,
    averageRating: averageRating(series),
  };
}
