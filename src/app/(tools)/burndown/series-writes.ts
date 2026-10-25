/**
 * What Burndown and Burnup write to a shared sprint: its settings (planned
 * points, dates) and its daily log. Every helper reads the workspace at the
 * moment it writes, through the sprint kit, never a React copy that may be
 * stale. Example sprints and sprints that no longer exist are never written.
 *
 * Each tool stores only what the user typed in it: Burndown the points
 * remaining and the scope-change flag, Burnup the scope and points done.
 * Notes are shared. The other tool's number is worked out on read. How one
 * day merges is lib/sprints/day-writes, shared with the agents' log_day.
 */

import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint, SprintDay, SprintSeries } from "@/lib/stores/workspace-types";
import { isExampleSprintId } from "@/lib/sprints/example";
import {
  withBurndownDay,
  withBurnupDay,
  type BurndownDayPatch,
  type BurnupDayPatch,
} from "@/lib/sprints/day-writes";
import { dayEntry, endDateFor, sprintLengthDays, withoutDay } from "@/lib/sprints/series";

// Shared with the legacy-data migration, so both apply the same rule.
export { remainingBefore, scopeFromRise } from "@/lib/sprints/series";
export {
  toDayPatch,
  withBurndownDay,
  withBurnupDay,
  type BurndownDayPatch,
  type BurnupDayPatch,
} from "@/lib/sprints/day-writes";
import { updateSeries, updateSprint } from "@/lib/sprints/store";

/** The stored sprint, or undefined for an example or a deleted sprint. */
function storedSprint(id: string): Sprint | undefined {
  if (isExampleSprintId(id)) return undefined;
  return useWorkspaceStore.getState().sprints.find((s) => s.id === id);
}

function currentSeries(id: string): SprintSeries | undefined {
  return useWorkspaceStore.getState().sprintSeries?.find((s) => s.id === id);
}

/* -------------------------------------------------------------------------- */
/*  Sprint settings                                                            */
/* -------------------------------------------------------------------------- */

export function setPlannedPoints(sprintId: string, points: number): Sprint | null {
  if (!storedSprint(sprintId) || !Number.isFinite(points) || points < 0) return null;
  return updateSprint(sprintId, { pointsPlanned: points });
}

/** Move the end date so the sprint lasts `days` days from its start. */
export function setSprintLength(sprintId: string, days: number): Sprint | null {
  const sprint = storedSprint(sprintId);
  if (!sprint || !Number.isFinite(days)) return null;
  return updateSprint(sprintId, { endDate: endDateFor(sprint.startDate, days) });
}

/** Move the start date, keeping the sprint's length. */
export function setSprintStart(sprintId: string, startDate: string): Sprint | null {
  const sprint = storedSprint(sprintId);
  if (!sprint || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null;
  const length = sprintLengthDays(sprint);
  return updateSprint(sprintId, { startDate, endDate: endDateFor(startDate, length) });
}

/** Set both dates (for sprints that have none yet). */
export function setSprintDates(
  sprintId: string,
  startDate: string,
  endDate: string
): Sprint | null {
  if (!storedSprint(sprintId)) return null;
  return updateSprint(sprintId, { startDate, endDate });
}

/* -------------------------------------------------------------------------- */
/*  Day writes                                                                 */
/* -------------------------------------------------------------------------- */

export interface DayWrite {
  /** The day as it was (undefined when nothing was stored). */
  before?: SprintDay;
  /** The day as it is now (undefined when it's empty). */
  after?: SprintDay;
}

/** Save a Burndown edit to one day. Null when nothing was written. */
export function writeBurndownDay(
  sprintId: string,
  day: number,
  patch: BurndownDayPatch
): DayWrite | null {
  const sprint = storedSprint(sprintId);
  if (!sprint) return null;
  const out: DayWrite = {};
  updateSeries(sprintId, (series) => {
    out.before = dayEntry(series, day);
    const next = withBurndownDay(sprint, series, day, patch);
    out.after = dayEntry(next, day);
    return next;
  });
  return out;
}

/** Flip a day's scope-change flag, from the flag as stored now. */
export function toggleScopeChange(sprintId: string, day: number): DayWrite | null {
  const flagged = Boolean(dayEntry(currentSeries(sprintId), day)?.scopeChange);
  return writeBurndownDay(sprintId, day, { scopeChange: !flagged });
}

/** Save a Burnup edit to one day. Null when nothing was written. */
export function writeBurnupDay(
  sprintId: string,
  day: number,
  patch: BurnupDayPatch
): DayWrite | null {
  if (!storedSprint(sprintId)) return null;
  const out: DayWrite = {};
  updateSeries(sprintId, (series) => {
    out.before = dayEntry(series, day);
    const next = withBurnupDay(series, day, patch);
    out.after = dayEntry(next, day);
    return next;
  });
  return out;
}

/* -------------------------------------------------------------------------- */
/*  Clearing, with what Undo needs                                             */
/* -------------------------------------------------------------------------- */

/** Fields set now win; the restored day fills in the rest. */
function mergeBack(restored: SprintDay, current: SprintDay | undefined): SprintDay {
  return current ? { ...restored, ...current } : restored;
}

/** Remove one day (in both tools). Returns what was there, for Undo. */
export function clearDay(sprintId: string, day: number): SprintDay | undefined {
  if (!storedSprint(sprintId)) return undefined;
  const removed = dayEntry(currentSeries(sprintId), day);
  if (!removed) return undefined;
  updateSeries(sprintId, (series) => withoutDay(series, day));
  return removed;
}

/** Put a cleared day back. Anything logged on it since stays. */
export function restoreDay(sprintId: string, removed: SprintDay): void {
  if (!storedSprint(sprintId)) return;
  updateSeries(sprintId, (series) => {
    const others = (series.days ?? []).filter((d) => d.day !== removed.day);
    const days = [...others, mergeBack(removed, dayEntry(series, removed.day))];
    days.sort((a, b) => a.day - b.day);
    return { ...series, days, updatedAt: new Date().toISOString() };
  });
}

/** Clear the whole daily log (in both tools). Returns the old days, for Undo. */
export function clearLog(sprintId: string): SprintDay[] {
  if (!storedSprint(sprintId)) return [];
  const previous = currentSeries(sprintId)?.days ?? [];
  if (previous.length === 0) return [];
  updateSeries(sprintId, (series) => ({
    ...series,
    days: [],
    updatedAt: new Date().toISOString(),
  }));
  return previous;
}

/** Put a cleared log back. Days logged since stay, filled in from the old log. */
export function restoreLog(sprintId: string, previous: readonly SprintDay[]): void {
  if (!storedSprint(sprintId) || previous.length === 0) return;
  updateSeries(sprintId, (series) => {
    const byDay = new Map<number, SprintDay>();
    for (const d of previous) byDay.set(d.day, d);
    for (const d of series.days ?? []) byDay.set(d.day, mergeBack(byDay.get(d.day) ?? d, d));
    const days = Array.from(byDay.values()).sort((a, b) => a.day - b.day);
    return { ...series, days, updatedAt: new Date().toISOString() };
  });
}
