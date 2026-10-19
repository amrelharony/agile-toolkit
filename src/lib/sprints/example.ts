/**
 * Example sprints for previews: four finished sprints and one in progress,
 * dated around today. They are never written to the workspace (fake
 * finished sprints would feed velocity forecasts, the dashboard and agents),
 * so tools render them as a read-only preview with a "Start your own" way out.
 */

import type { Sprint, SprintSeries } from "@/lib/stores/workspace-types";
import { SPRINT_RATING_DIMENSIONS, endDateFor, todayIso } from "./series";

export const EXAMPLE_SPRINT_PREFIX = "example-sprint-";

export function isExampleSprintId(id: string): boolean {
  return id.startsWith(EXAMPLE_SPRINT_PREFIX);
}

const LENGTH = 14;
const PAST = [
  { planned: 34, completed: 29 },
  { planned: 32, completed: 31 },
  { planned: 36, completed: 30 },
  { planned: 33, completed: 33 },
];
/** Ratings per past sprint, in `SPRINT_RATING_DIMENSIONS` order. */
const RATINGS = [
  [6, 7, 5, 6, 6, 5],
  [7, 7, 7, 7, 8, 7],
  [6, 8, 4, 6, 6, 6],
  [8, 8, 8, 8, 9, 8],
];
/** Remaining points logged on days 0..5 of the current sprint (day 3: scope added). */
const CURRENT_REMAINING = [35, 33, 29, 32, 27, 24];

function shift(iso: string, days: number): string {
  return endDateFor(iso, days);
}

export interface ExampleSprints {
  sprints: Sprint[];
  series: SprintSeries[];
  /** The in-progress sprint (the natural selection for a preview). */
  current: Sprint;
}

/** Example data dated so the current sprint is on day 5 today. */
export function exampleSprints(today: string = todayIso()): ExampleSprints {
  const currentStart = shiftBack(today, 5);
  const sprints: Sprint[] = PAST.map((p, i) => {
    const start = shiftBack(currentStart, LENGTH * (PAST.length - i));
    return {
      id: `${EXAMPLE_SPRINT_PREFIX}${i + 1}`,
      name: `Sprint ${i + 1}`,
      startDate: start,
      endDate: shift(start, LENGTH),
      pointsPlanned: p.planned,
      pointsCompleted: p.completed,
      status: "completed",
    };
  });
  const current: Sprint = {
    id: `${EXAMPLE_SPRINT_PREFIX}${PAST.length + 1}`,
    name: `Sprint ${PAST.length + 1}`,
    startDate: currentStart,
    endDate: shift(currentStart, LENGTH),
    goal: "Customers can pay with a saved card",
    pointsPlanned: 35,
    status: "active",
  };
  sprints.push(current);

  const series: SprintSeries[] = sprints.slice(0, PAST.length).map((s, i) => ({
    id: s.id,
    ratings: Object.fromEntries(SPRINT_RATING_DIMENSIONS.map((d, j) => [d, RATINGS[i][j]])),
  }));
  series.push({
    id: current.id,
    days: CURRENT_REMAINING.map((remaining, day) =>
      day === 3
        ? { day, remaining, scope: 40, scopeChange: true, note: "Refund flow added" }
        : { day, remaining }
    ),
  });
  return { sprints, series, current };
}

function shiftBack(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
