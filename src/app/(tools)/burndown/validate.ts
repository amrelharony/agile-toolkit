/**
 * What the burndown and the shared sprint settings accept, as messages for
 * the field that holds them. A field that can't be saved keeps what was
 * typed and says why (DraftInput's reject path), so nothing is dropped
 * silently and nothing half-typed reaches the shared sprint.
 */

import { MAX_SPRINT_LENGTH_DAYS } from "@/lib/sprints/cadence";
import { isIsoDate } from "@/lib/sprints/calendar";

/** The largest number of points a field takes: past it the input is a typo, not a sprint. */
export const MAX_POINTS = 100_000;

/** A parsed points field: a number, or null for a blank field (it clears the day). */
export type PointsResult = { ok: true; value: number | null } | { ok: false; error: string };

/**
 * Points typed for a day: blank clears it; otherwise 0 or more, up to
 * MAX_POINTS. `what` names the number in the message ("points left").
 */
export function validatePoints(raw: string, what = "points"): PointsResult {
  const text = raw.trim();
  if (text === "") return { ok: true, value: null };
  const n = Number(text);
  if (!Number.isFinite(n)) return { ok: false, error: `Enter the ${what} as a number.` };
  if (n < 0) return { ok: false, error: `Enter 0 or more ${what}.` };
  if (n > MAX_POINTS) return { ok: false, error: `Enter at most ${MAX_POINTS} ${what}.` };
  return { ok: true, value: n };
}

/** Burndown's points left for a day. */
export function validateRemaining(raw: string): PointsResult {
  return validatePoints(raw, "points left");
}

/** The sprint's planned points: a number of 0 or more (blank isn't 0). */
export function validatePlannedPoints(
  raw: string
): { ok: true; value: number } | { ok: false; error: string } {
  if (raw.trim() === "") return { ok: false, error: "Enter the points the team committed to." };
  const r = validatePoints(raw, "points");
  return r.ok ? { ok: true, value: r.value as number } : r;
}

/** The sprint's length in calendar days: a whole number from 1 to the cadence's maximum. */
export function validateLength(
  raw: string
): { ok: true; value: number } | { ok: false; error: string } {
  const text = raw.trim();
  const n = Number(text);
  if (text === "" || !Number.isFinite(n))
    return { ok: false, error: "Enter the sprint's length in days." };
  if (!Number.isInteger(n)) return { ok: false, error: "Enter a whole number of days." };
  if (n < 1 || n > MAX_SPRINT_LENGTH_DAYS) {
    return { ok: false, error: `A sprint lasts 1 to ${MAX_SPRINT_LENGTH_DAYS} days.` };
  }
  return { ok: true, value: n };
}

/** The sprint's first day: a real date (any year from 2000, so a half-typed year isn't saved). */
export function validateStartDate(
  raw: string
): { ok: true; value: string } | { ok: false; error: string } {
  const text = raw.trim();
  if (!isIsoDate(text) || text.length !== 10 || text < "2000-01-01" || text > "2099-12-31") {
    return { ok: false, error: "Pick the sprint's first day." };
  }
  return { ok: true, value: text };
}
