/**
 * One sprint's status, from its plan and its daily log: the numbers the
 * Sprint Metrics hub shows. The burndown and burnup figures use the same
 * formulas as the `tool.burndown.compute` and `tool.burnup.compute` MCP
 * actions (a parity test keeps them equal), on the calendar-day convention
 * the tools chart: day 0 is the start date and the ideal line reaches 0 on
 * the last day.
 *
 * Days in between logged days count as "no change" (the previous reading
 * carries forward), so a missed day doesn't read as a sudden drop.
 */

import type { Sprint, SprintSeries } from "@/lib/stores/workspace-types";
import {
  averageRating,
  completedAt,
  lastLoggedDay,
  loggedDayCount,
  remainingAt,
  scopeAt,
  sprintLengthDays,
} from "./series";

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Least-squares fit of ys against x = 0..n-1 (the MCP compute actions' fit). */
export function fitLine(ys: readonly number[]): { slope: number; intercept: number } {
  const n = ys.length;
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0 };
  const sumX = (n * (n - 1)) / 2;
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = ys.reduce((a, y, i) => a + i * y, 0);
  const sumXX = ys.reduce((a, _y, i) => a + i * i, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };
  const slope = (n * sumXY - sumX * sumY) / denom;
  return { slope, intercept: (sumY - slope * sumX) / n };
}

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

/** The hub's numbers for one sprint. */
export function sprintStatus(sprint: Sprint, series: SprintSeries | undefined): SprintStatus {
  const lengthDays = sprintLengthDays(sprint);
  const dense = denseSeries(sprint, series);
  const lastDay = dense.remaining.length > 0 ? dense.remaining.length - 1 : null;
  const committed = sprint.pointsPlanned;
  const scopeNow = lastDay === null ? committed : dense.scope[lastDay];

  let idealRemaining: number | null = null;
  let gap: number | null = null;
  let projectedFinishDay: number | null = null;
  let remaining: number | null = null;
  let done: number | null = null;
  if (lastDay !== null) {
    remaining = dense.remaining[lastDay];
    done = dense.completed[lastDay];
    // tool.burndown.compute with sprintDays = lengthDays + 1: the ideal line
    // runs from the plan on day 0 to 0 on day lengthDays.
    idealRemaining = lengthDays > 0 ? committed * (1 - lastDay / lengthDays) : 0;
    gap = remaining - idealRemaining;
    const { slope, intercept } = fitLine(dense.remaining);
    projectedFinishDay = slope < 0 ? round1(-intercept / slope) : null;
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
    percentDone:
      done === null || scopeNow <= 0 ? null : Math.min(100, Math.round((done / scopeNow) * 100)),
    idealRemaining: idealRemaining === null ? null : round1(idealRemaining),
    gap: gap === null ? null : round1(gap),
    onTrack: gap === null ? null : gap <= 0,
    projectedFinishDay,
    willFinishOnTime: projectedFinishDay === null ? null : projectedFinishDay <= lengthDays,
    averageRating: averageRating(series),
  };
}

/** Mean completed points of the latest `n` completed sprints (with points), or null. */
export function recentVelocity(completedSprints: readonly Sprint[], n = 3): number | null {
  const points = completedSprints
    .filter((s) => s.status === "completed" && typeof s.pointsCompleted === "number")
    .slice(-n)
    .map((s) => s.pointsCompleted as number);
  if (points.length === 0) return null;
  return round1(points.reduce((a, b) => a + b, 0) / points.length);
}
