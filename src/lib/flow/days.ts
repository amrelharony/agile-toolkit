/**
 * Local calendar days as numbers, so the flow maths can step, compare and
 * count days without a time zone or a daylight-saving change moving one. A
 * timestamp is first read as its local day (lib/sprints/series localDay),
 * then numbered like a sprint date (lib/sprints/calendar isoDayNumber).
 */

import { isoDayNumber, isoFromDayNumber } from "@/lib/sprints/calendar";
import { localDay } from "@/lib/sprints/series";

/** The longest range a chart is built over; a corrupt far-past date can't make a huge one. */
export const MAX_RANGE_DAYS = 1000;

/** The day number of a timestamp's (or a "YYYY-MM-DD"'s) local day, or null. */
export function dayNumber(value: string | null | undefined): number | null {
  return isoDayNumber(localDay(value));
}

/** The local day `n` days after `day` (before it when negative), or null when `day` isn't one. */
export function addDays(day: string | null | undefined, n: number): string | null {
  const d = dayNumber(day);
  return d === null || !Number.isFinite(n) ? null : isoFromDayNumber(d + Math.trunc(n));
}

/**
 * Every local day from `from` to `to`, both included, oldest first; empty
 * when either isn't a day or `to` comes first. At most `MAX_RANGE_DAYS`
 * (the latest), since the recent end is the one a chart is read for.
 */
export function dayRange(from: string, to: string): string[] {
  const a = dayNumber(from);
  const b = dayNumber(to);
  if (a === null || b === null || b < a) return [];
  const out: string[] = [];
  for (let n = Math.max(a, b - MAX_RANGE_DAYS + 1); n <= b; n++) out.push(isoFromDayNumber(n));
  return out;
}
