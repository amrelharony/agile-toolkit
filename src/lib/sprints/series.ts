/**
 * Pure helpers for a sprint's shared daily log (`SprintSeries`).
 *
 * Day 0 is `Sprint.startDate`, counted in calendar days, and the last day is
 * `sprintLengthDays(sprint)` (the end date). Burndown records `remaining`,
 * Burnup records `completed` and `scope`. Whatever was typed is kept as is;
 * the other number is derived here, so the two tools agree without one
 * overwriting the other.
 */

import type { Sprint, SprintDay, SprintSeries } from "@/lib/stores/workspace-types";

/** Sprint length used when a sprint has no usable dates. */
export const DEFAULT_SPRINT_DAYS = 10;

/** The dimensions Sprint Comparison rates (1-10), as stored in `SprintSeries.ratings`. */
export const SPRINT_RATING_DIMENSIONS = [
  "Velocity",
  "Quality",
  "Scope Stability",
  "Team Happiness",
  "Goal Achievement",
  "Predictability",
] as const;
export type SprintRatingDimension = (typeof SPRINT_RATING_DIMENSIONS)[number];

const DAY_MS = 86_400_000;
const NO_DAYS: SprintDay[] = [];

/** "YYYY-MM-DD..." to a UTC day number, or null when it isn't a date. */
function utcDay(iso: string | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? Math.round(t / DAY_MS) : null;
}

function fromUtcDay(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/** Today as YYYY-MM-DD in local time. */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Days from start to end (the last day's index), or the default when dates are missing. */
export function sprintLengthDays(sprint: Pick<Sprint, "startDate" | "endDate">): number {
  const start = utcDay(sprint.startDate);
  const end = utcDay(sprint.endDate);
  if (start === null || end === null || end <= start) return DEFAULT_SPRINT_DAYS;
  return end - start;
}

/** The calendar date of day `day`, or null when the sprint has no start date. */
export function dayDate(sprint: Pick<Sprint, "startDate">, day: number): string | null {
  const start = utcDay(sprint.startDate);
  return start === null ? null : fromUtcDay(start + day);
}

/** Which day of the sprint `date` is (may be negative or past the end), or null. */
export function dayForDate(sprint: Pick<Sprint, "startDate">, date: string): number | null {
  const start = utcDay(sprint.startDate);
  const at = utcDay(date);
  return start === null || at === null ? null : at - start;
}

/** End date for a sprint that starts on `startDate` and lasts `days` days. */
export function endDateFor(startDate: string, days: number): string {
  const start = utcDay(startDate);
  return start === null ? "" : fromUtcDay(start + Math.max(1, Math.round(days)));
}

/**
 * True when the sprint's dates can't place its days on a calendar: a missing
 * start or end, or the placeholder dates the old Velocity tool gave sprints
 * (consecutive days from 1 Jan 2020).
 */
export function hasSyntheticDates(sprint: Pick<Sprint, "startDate" | "endDate">): boolean {
  if (utcDay(sprint.startDate) === null || utcDay(sprint.endDate) === null) return true;
  return sprint.startDate.startsWith("2020-01-") && sprint.startDate.slice(0, 10) <= "2020-01-31";
}

/** Status a sprint should have on `today`, from its dates. */
export function statusFromDates(
  sprint: Pick<Sprint, "startDate" | "endDate">,
  today: string = todayIso()
): Sprint["status"] {
  const start = utcDay(sprint.startDate);
  const end = utcDay(sprint.endDate);
  const now = utcDay(today);
  if (start === null || now === null) return "planned";
  if (now < start) return "planned";
  if (end !== null && now > end) return "completed";
  return "active";
}

/** The series for `sprintId`, or an empty one (not yet stored). */
export function seriesFor(
  all: readonly SprintSeries[] | undefined,
  sprintId: string
): SprintSeries {
  return all?.find((s) => s.id === sprintId) ?? { id: sprintId };
}

/** Logged days, sorted by day. */
export function sortedDays(series: SprintSeries | undefined): SprintDay[] {
  const days = series?.days ?? NO_DAYS;
  return days.length < 2 ? days : [...days].sort((a, b) => a.day - b.day);
}

export function dayEntry(series: SprintSeries | undefined, day: number): SprintDay | undefined {
  return series?.days?.find((d) => d.day === day);
}

function isEmptyDay(d: SprintDay): boolean {
  return (
    d.remaining == null &&
    d.completed == null &&
    d.scope == null &&
    !d.scopeChange &&
    !(d.note && d.note.trim())
  );
}

/**
 * Set fields on one day. A field set to `undefined` is removed, and a day
 * left with nothing on it is dropped. Days stay sorted.
 */
export function withDay(
  series: SprintSeries,
  day: number,
  patch: Partial<Omit<SprintDay, "day">>,
  now: string = new Date().toISOString()
): SprintSeries {
  const current: SprintDay = dayEntry(series, day) ?? { day };
  const next: SprintDay = { ...current };
  for (const [key, value] of Object.entries(patch) as [keyof SprintDay, unknown][]) {
    if (value === undefined) delete next[key];
    else (next as unknown as Record<string, unknown>)[key] = value;
  }
  next.day = day;
  const others = (series.days ?? NO_DAYS).filter((d) => d.day !== day);
  const days = isEmptyDay(next) ? others : [...others, next];
  days.sort((a, b) => a.day - b.day);
  return { ...series, days, updatedAt: now };
}

/** Remove one day's entry. */
export function withoutDay(
  series: SprintSeries,
  day: number,
  now: string = new Date().toISOString()
): SprintSeries {
  return { ...series, days: (series.days ?? NO_DAYS).filter((d) => d.day !== day), updatedAt: now };
}

/** Merge ratings in (a value of `undefined` removes that dimension). */
export function withRatings(
  series: SprintSeries,
  ratings: Record<string, number | undefined>,
  now: string = new Date().toISOString()
): SprintSeries {
  const next: Record<string, number> = { ...(series.ratings ?? {}) };
  for (const [k, v] of Object.entries(ratings)) {
    if (v === undefined || !Number.isFinite(v)) delete next[k];
    else next[k] = v;
  }
  return { ...series, ratings: next, updatedAt: now };
}

/** Total scope on `day`: that day's, else the latest earlier one, else the plan. */
export function scopeAt(
  sprint: Pick<Sprint, "pointsPlanned">,
  series: SprintSeries | undefined,
  day: number
): number {
  let best: SprintDay | undefined;
  for (const d of series?.days ?? NO_DAYS) {
    if (d.day <= day && d.scope != null && (!best || d.day > best.day)) best = d;
  }
  return best?.scope ?? sprint.pointsPlanned;
}

/** Points left on `day`: as typed, else scope minus completed, else null. */
export function remainingAt(
  sprint: Pick<Sprint, "pointsPlanned">,
  series: SprintSeries | undefined,
  day: number
): number | null {
  const d = dayEntry(series, day);
  if (!d) return null;
  if (d.remaining != null) return d.remaining;
  if (d.completed != null) return Math.max(0, scopeAt(sprint, series, day) - d.completed);
  return null;
}

/** Points done by `day`: as typed, else scope minus remaining, else null. */
export function completedAt(
  sprint: Pick<Sprint, "pointsPlanned">,
  series: SprintSeries | undefined,
  day: number
): number | null {
  const d = dayEntry(series, day);
  if (!d) return null;
  if (d.completed != null) return d.completed;
  if (d.remaining != null) return Math.max(0, scopeAt(sprint, series, day) - d.remaining);
  return null;
}

/**
 * Points remaining on the latest day before `day` that has a number (typed
 * in either tool), else the scope the sprint started with.
 */
export function remainingBefore(
  sprint: Pick<Sprint, "pointsPlanned">,
  series: SprintSeries | undefined,
  day: number
): number {
  for (let d = day - 1; d >= 0; d--) {
    const r = remainingAt(sprint, series, d);
    if (r !== null) return r;
  }
  return day > 0 ? scopeAt(sprint, series, 0) : sprint.pointsPlanned;
}

/**
 * The scope Burndown records on a day flagged as a scope change: the scope
 * before that day plus however much the remaining points rose. Null when
 * remaining didn't rise (nothing to add to Burnup's scope line).
 */
export function scopeFromRise(
  sprint: Pick<Sprint, "pointsPlanned">,
  series: SprintSeries | undefined,
  day: number
): number | null {
  const remaining = dayEntry(series, day)?.remaining;
  if (remaining == null) return null;
  const rise = remaining - remainingBefore(sprint, series, day);
  return rise > 0 ? Math.round((scopeAt(sprint, series, day - 1) + rise) * 10) / 10 : null;
}

/** The last day with a remaining or completed number, or null. */
export function lastLoggedDay(series: SprintSeries | undefined): number | null {
  let last: number | null = null;
  for (const d of series?.days ?? NO_DAYS) {
    if ((d.remaining != null || d.completed != null) && (last === null || d.day > last)) {
      last = d.day;
    }
  }
  return last;
}

/** How many days have a remaining or completed number. */
export function loggedDayCount(series: SprintSeries | undefined): number {
  return (series?.days ?? NO_DAYS).filter((d) => d.remaining != null || d.completed != null).length;
}

/** Mean of the ratings, rounded to one decimal, or null when there are none. */
export function averageRating(series: SprintSeries | undefined): number | null {
  const values = Object.values(series?.ratings ?? {}).filter((v) => Number.isFinite(v));
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

/** Sprints newest first: by start date, undated ones last, then by name. */
export function sprintsNewestFirst(sprints: readonly Sprint[]): Sprint[] {
  return [...sprints].sort((a, b) => {
    const da = utcDay(a.startDate);
    const db = utcDay(b.startDate);
    if (da !== db) {
      if (da === null) return 1;
      if (db === null) return -1;
      return db - da;
    }
    return a.name.localeCompare(b.name);
  });
}
