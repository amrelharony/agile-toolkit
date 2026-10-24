/**
 * What Burnup's daily log accepts, and what it accepts but questions. A
 * number it can't save keeps what was typed and says why; a number that is
 * saved but reads oddly against the rest of the log (points done falling,
 * or passing the scope) gets a note under it, without blocking.
 */

import { validatePoints, type PointsResult } from "../burndown/validate";
import type { BurnupRow } from "./view";

/** The scope typed for a day: blank carries the day before (or the plan) forward. */
export function validateScope(raw: string): PointsResult {
  return validatePoints(raw, "scope points");
}

/** Points done by the end of a day (a running total): blank clears the day. */
export function validateCompleted(raw: string): PointsResult {
  return validatePoints(raw, "points done");
}

/**
 * A note on a typed "points done" that reads oddly: lower than an earlier
 * day's (it's a running total) or more than the scope in force that day.
 * Null when it reads fine, or nothing was typed.
 */
export function completedWarning(rows: readonly BurnupRow[], day: number): string | null {
  const row = rows.find((r) => r.day === day);
  const typed = row?.typedCompleted;
  if (!row || typed == null) return null;
  let best: { day: number; value: number } | null = null;
  for (const r of rows) {
    if (r.day >= day || r.completed === null) continue;
    if (!best || r.completed > best.value) best = { day: r.day, value: r.completed };
  }
  if (best && typed < best.value) {
    return `Lower than day ${best.day}'s ${best.value}: points done is a running total.`;
  }
  if (typed > row.scopeInForce) {
    return `More than the ${row.scopeInForce} points in scope that day.`;
  }
  return null;
}
