/**
 * Pure helpers for a sprint's shared daily log (`SprintSeries`).
 *
 * Day 0 is `Sprint.startDate`, counted in calendar days, and the last day is
 * `sprintLengthDays(sprint)` (the end date). Burndown records `remaining`,
 * Burnup records `completed` and `scope`. Whatever was typed is kept as is;
 * the other number is derived here, so the two tools agree without one
 * overwriting the other.
 *
 * Stored day numbers are always calendar days. The ideal line can instead
 * run on working days (`workingDayAxis`, `idealRemainingAt` with a
 * `WorkingCalendar` from ./calendar.ts): it then stays flat over weekends
 * and holidays and still reaches 0 on the last day.
 */

import type { Sprint, SprintDay, SprintSeries } from "@/lib/stores/workspace-types";
import {
  addWorkingDays,
  countWorkingDays,
  isoDayNumber,
  isoFromDayNumber,
  type WorkingCalendar,
} from "./calendar";

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

const NO_DAYS: SprintDay[] = [];

const utcDay = isoDayNumber;
const fromUtcDay = isoFromDayNumber;

/** Today as YYYY-MM-DD in local time. */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * The local calendar day of a timestamp (or a plain "YYYY-MM-DD" as it is),
 * or null. Stamps are UTC ISO strings, so slicing them would put an evening's
 * move on the next day east of UTC (or the previous one west of it).
 */
export function localDay(value: string | undefined | null): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const t = Date.parse(value);
  if (Number.isFinite(t)) return todayIso(new Date(t));
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return m ? m[1] : null;
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

/**
 * Which day of the sprint `date` is (may be negative or past the end), or
 * null. This is the calendar day, the index the daily log is stored under;
 * `workingDayForDate` counts working days instead.
 */
export function dayForDate(sprint: Pick<Sprint, "startDate">, date: string): number | null {
  const start = utcDay(sprint.startDate);
  const at = utcDay(date);
  return start === null || at === null ? null : at - start;
}

/**
 * Working days done by the morning of `date`: the working dates from the
 * start date up to, but not including, `date` (negative before the start).
 * 0 on the first day, flat over weekends and holidays. Null without dates.
 */
export function workingDayForDate(
  sprint: Pick<Sprint, "startDate">,
  date: string,
  calendar: WorkingCalendar
): number | null {
  const start = utcDay(sprint.startDate);
  const at = utcDay(date);
  if (start === null || at === null) return null;
  return at >= start
    ? countWorkingDays(start, at, calendar)
    : -countWorkingDays(at, start, calendar);
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

/**
 * Whether the ideal line can run on `calendar`'s working days for this
 * sprint: a calendar was given, the dates are real, and the sprint holds at
 * least one working day. Otherwise the calendar-day convention applies.
 */
function usesWorkingDays(
  sprint: Pick<Sprint, "startDate" | "endDate">,
  calendar: WorkingCalendar | undefined
): calendar is WorkingCalendar {
  if (!calendar || hasSyntheticDates(sprint)) return false;
  const start = utcDay(sprint.startDate) as number;
  return countWorkingDays(start, start + sprintLengthDays(sprint), calendar) > 0;
}

/**
 * Where calendar day `day` (0 or later) sits on the ideal line's x-axis: the
 * working days done by its morning, or `day` itself under the calendar-day
 * convention (no calendar, placeholder dates, or no working day at all).
 */
export function elapsedWorkingDays(
  sprint: Pick<Sprint, "startDate" | "endDate">,
  day: number,
  calendar?: WorkingCalendar
): number {
  const d = Math.max(0, day);
  if (!usesWorkingDays(sprint, calendar)) return d;
  const start = utcDay(sprint.startDate) as number;
  return countWorkingDays(start, start + Math.floor(d), calendar);
}

/** Working days in the whole sprint (its x-axis length); the calendar length without one. */
export function sprintWorkingDays(
  sprint: Pick<Sprint, "startDate" | "endDate">,
  calendar?: WorkingCalendar
): number {
  return elapsedWorkingDays(sprint, sprintLengthDays(sprint), calendar);
}

/** `elapsedWorkingDays` for each day 0 … sprintLengthDays. */
export function workingDayAxis(
  sprint: Pick<Sprint, "startDate" | "endDate">,
  calendar?: WorkingCalendar
): number[] {
  const length = sprintLengthDays(sprint);
  if (!usesWorkingDays(sprint, calendar)) return Array.from({ length: length + 1 }, (_, d) => d);
  const start = utcDay(sprint.startDate) as number;
  const axis = [0];
  for (let d = 1; d <= length; d++) {
    axis.push(axis[d - 1] + countWorkingDays(start + d - 1, start + d, calendar));
  }
  return axis;
}

/**
 * The ideal remaining points on day `day`: `committed` on day 0, 0 on the
 * last day, burning only on working days when a calendar is given. Days
 * before the start read as day 0, days after the end as the last day.
 */
export function idealRemainingAt(
  sprint: Pick<Sprint, "startDate" | "endDate">,
  committed: number,
  day: number,
  calendar?: WorkingCalendar
): number {
  const length = sprintLengthDays(sprint);
  const total = sprintWorkingDays(sprint, calendar);
  if (total <= 0) return 0;
  const done = elapsedWorkingDays(sprint, Math.min(Math.max(0, day), length), calendar);
  return committed * (1 - done / total);
}

/** The ideal line for days 0 … sprintLengthDays. */
export function idealLine(
  sprint: Pick<Sprint, "startDate" | "endDate">,
  committed: number,
  calendar?: WorkingCalendar
): number[] {
  const axis = workingDayAxis(sprint, calendar);
  const total = axis[axis.length - 1];
  return axis.map((done) => (total > 0 ? committed * (1 - done / total) : 0));
}

/**
 * The calendar day by whose morning `workingDays` working days are done (the
 * inverse of `elapsedWorkingDays`, rounding up), possibly past the end.
 * Under the calendar-day convention it is `workingDays` itself.
 */
export function dayForWorkingDay(
  sprint: Pick<Sprint, "startDate" | "endDate">,
  workingDays: number,
  calendar?: WorkingCalendar
): number {
  if (!usesWorkingDays(sprint, calendar)) return workingDays;
  const date = addWorkingDays(sprint.startDate, workingDays, calendar);
  return (date === null ? null : dayForDate(sprint, date)) ?? workingDays;
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

/**
 * Mean of the Sprint Comparison ratings, rounded to one decimal, or null
 * when there are none. Only its six dimensions count: a stray key (a hand
 * edit, an older client) must not move the average.
 */
export function averageRating(series: SprintSeries | undefined): number | null {
  const ratings = series?.ratings ?? {};
  const values = SPRINT_RATING_DIMENSIONS.map((d) => ratings[d]).filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v)
  );
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

/** The chosen sprint if it exists, else the active one, else the newest (not cancelled). */
export function pickDefaultSprint(
  sprints: readonly Sprint[],
  chosenId: string | null | undefined
): Sprint | undefined {
  if (chosenId) {
    const chosen = sprints.find((s) => s.id === chosenId);
    if (chosen) return chosen;
  }
  const newest = sprintsNewestFirst(sprints);
  return (
    newest.find((s) => s.status === "active") ??
    newest.find((s) => s.status !== "cancelled") ??
    newest[0]
  );
}
