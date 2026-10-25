/**
 * How Burndown and Burnup change one day of a sprint's shared log, as pure
 * functions over a SprintSeries, so the pages (burndown/series-writes) and
 * the agents' `tool.burndown.log_day` / `tool.burnup.log_day` merge a day
 * the same way. Each tool stores only what was typed in it: Burndown the
 * points remaining and the scope-change flag, Burnup the scope and points
 * done. Notes are shared. The other tool's number is worked out on read.
 */

import type { Sprint, SprintDay, SprintSeries } from "@/lib/stores/workspace-types";
import { dayEntry, scopeFromRise, withDay } from "./series";

export interface BurndownDayPatch {
  remaining?: number | null;
  scopeChange?: boolean;
  note?: string | null;
}

export interface BurnupDayPatch {
  scope?: number | null;
  completed?: number | null;
  note?: string | null;
}

/** Only the keys present in `patch`; blank values become `undefined` (removed). */
export function toDayPatch(
  patch: BurndownDayPatch & BurnupDayPatch
): Partial<Omit<SprintDay, "day">> {
  const out: Partial<Omit<SprintDay, "day">> = {};
  if ("remaining" in patch) out.remaining = patch.remaining ?? undefined;
  if ("completed" in patch) out.completed = patch.completed ?? undefined;
  if ("scope" in patch) out.scope = patch.scope ?? undefined;
  if ("scopeChange" in patch) out.scopeChange = patch.scopeChange ? true : undefined;
  if ("note" in patch) out.note = patch.note && patch.note.trim() ? patch.note : undefined;
  return out;
}

/**
 * Apply a Burndown edit to one day. On a day flagged as a scope change where
 * remaining rose, Burndown also keeps that day's `scope` in step (so
 * Burnup's scope line rises too), and takes it back off when the flag goes.
 * A scope Burnup typed is never touched: Burndown only manages a scope it
 * could have written itself.
 */
export function withBurndownDay(
  sprint: Pick<Sprint, "pointsPlanned">,
  series: SprintSeries,
  day: number,
  patch: BurndownDayPatch,
  now: string = new Date().toISOString()
): SprintSeries {
  const before = dayEntry(series, day);
  const storedScope = before?.scope ?? null;
  const wasFlagged = Boolean(before?.scopeChange);
  const ownsScope =
    storedScope === null || (wasFlagged && storedScope === scopeFromRise(sprint, series, day));

  let next = withDay(series, day, toDayPatch(patch), now);
  if (!ownsScope) return next;

  const flagged = Boolean(dayEntry(next, day)?.scopeChange);
  const scope = flagged ? scopeFromRise(sprint, next, day) : null;
  if (scope !== null) next = withDay(next, day, { scope }, now);
  else if (storedScope !== null) next = withDay(next, day, { scope: undefined }, now);
  return next;
}

/** Apply a Burnup edit to one day (scope, points done, note): a plain merge. */
export function withBurnupDay(
  series: SprintSeries,
  day: number,
  patch: BurnupDayPatch,
  now: string = new Date().toISOString()
): SprintSeries {
  return withDay(series, day, toDayPatch(patch), now);
}
