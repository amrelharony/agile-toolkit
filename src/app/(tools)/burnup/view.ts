/**
 * The burnup's view of a shared sprint: the sprint and its daily log in the
 * `{config, entries}` shape the chart and the AI prompts have always taken.
 *
 * - `config.sprintDays` is the sprint's length (day 0 is the start date),
 *   `sprintStartDate` its start date.
 * - Each entry's `scope` is the scope stored that day (day 0 falls back to
 *   the sprint's planned points, and the chart carries it forward), and
 *   `completed` is what Burnup typed, else what Burndown's remaining points
 *   work out to, else 0 on day 0. `typedCompleted` and `derivedCompleted`
 *   say which, so a worked-out number is shown dimmed, not as if typed.
 */

import type { Sprint, SprintSeries } from "@/lib/stores/workspace-types";
import { completedAt, dayEntry, scopeAt, sprintLengthDays } from "@/lib/sprints/series";
import { viewDays } from "../burndown/view";

/** The burnup's shapes, as the chart and the AI prompts take them. */
export interface BurnupDayEntry {
  id: string;
  day: number;
  scope: number | null;
  completed: number | null;
  description?: string;
}

export interface BurnupConfig {
  sprintDays: number;
  sprintStartDate: string;
}

export interface BurnupRow extends BurnupDayEntry {
  /** Scope as stored for this day (typed in Burnup, or a Burndown scope change), or null. */
  typedScope: number | null;
  /** Scope in force that day: stored, carried forward, or the plan. */
  scopeInForce: number;
  /** Points done as typed in Burnup, or null. */
  typedCompleted: number | null;
  /** Points done worked out from Burndown's remaining (shown dimmed), or null. */
  derivedCompleted: number | null;
  /** Anything stored for this day, by either tool (it can be cleared). */
  stored: boolean;
  /** A day past the sprint's end (logged before the sprint was shortened). */
  afterEnd: boolean;
}

export interface BurnupView {
  config: BurnupConfig;
  entries: BurnupRow[];
}

export function burnupView(sprint: Sprint, series: SprintSeries | undefined): BurnupView {
  const sprintDays = sprintLengthDays(sprint);
  const config: BurnupConfig = { sprintDays, sprintStartDate: sprint.startDate.slice(0, 10) };

  const entries = viewDays(series, sprintDays).map((day): BurnupRow => {
    const stored = dayEntry(series, day);
    const typedScope = stored?.scope ?? null;
    const typedCompleted = stored?.completed ?? null;
    const derivedCompleted = typedCompleted === null ? completedAt(sprint, series, day) : null;
    return {
      id: `${sprint.id}:day-${day}`,
      day,
      scope: typedScope ?? (day === 0 ? sprint.pointsPlanned : null),
      completed: typedCompleted ?? derivedCompleted ?? (day === 0 ? 0 : null),
      ...(stored?.note ? { description: stored.note } : {}),
      typedScope,
      scopeInForce: scopeAt(sprint, series, day),
      typedCompleted,
      derivedCompleted,
      stored: Boolean(stored),
      afterEnd: day > sprintDays,
    };
  });

  return { config, entries };
}
