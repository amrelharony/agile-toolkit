/**
 * Working days for the sprint maths: the weekdays the team works (Monday to
 * Friday unless the cadence says otherwise) minus the team's holidays. Pure.
 *
 * Dates are "YYYY-MM-DD" (anything after the date is ignored) and are
 * counted as UTC day numbers, so a time zone or a daylight-saving change
 * never moves a day. Ranges are half-open: `workingDaysBetween(a, b)` counts
 * the working dates from `a` up to, but not including, `b`. That matches the
 * sprint's day numbers (./series.ts): by the morning of day `d`, the work of
 * days 0 … d-1 is done. Working hours (`workingHoursBetween`, at the end)
 * count the same days by the minute, for times shorter than a sprint.
 */

/** Weekdays the team works when nothing else is set: Monday to Friday. */
export const DEFAULT_WORKING_DAYS: readonly number[] = [1, 2, 3, 4, 5];

/** At most this many holidays are kept (a few years' worth). */
export const MAX_HOLIDAYS = 400;

export interface WorkingCalendar {
  /** Weekdays the team works: 0 = Sunday … 6 = Saturday. Never empty. */
  workingDays: readonly number[];
  /** Team holidays, "YYYY-MM-DD", sorted and unique. */
  holidays: readonly string[];
}

export const DEFAULT_CALENDAR: WorkingCalendar = {
  workingDays: DEFAULT_WORKING_DAYS,
  holidays: [],
};

const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * "YYYY-MM-DD..." to a UTC day number, or null when it isn't shaped like a
 * date. An impossible day rolls over the way `Date.UTC` does ("2026-09-31"
 * is 1 October), as sprint dates always have; `isIsoDate` is the strict check.
 */
export function isoDayNumber(iso: string | undefined | null): number | null {
  const m = ISO_DATE.exec(iso ?? "");
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? Math.round(t / DAY_MS) : null;
}

/** Whether `iso` starts with a date that exists ("2026-02-30" doesn't). */
export function isIsoDate(iso: string | undefined | null): boolean {
  const n = isoDayNumber(iso);
  return n !== null && isoFromDayNumber(n) === (iso ?? "").slice(0, 10);
}

/** A UTC day number back to "YYYY-MM-DD". */
export function isoFromDayNumber(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday for a UTC day number (day 0, 1 Jan 1970, was a Thursday). */
function weekdayOfDayNumber(n: number): number {
  return (((n + 4) % 7) + 7) % 7;
}

/** The weekday of a date (0 = Sunday … 6 = Saturday), or null when it isn't a date. */
export function weekdayOf(iso: string): number | null {
  const n = isoDayNumber(iso);
  return n === null ? null : weekdayOfDayNumber(n);
}

function isWeekday(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 6;
}

/** Valid weekdays, unique and sorted; null when none are valid. */
export function normalizeWorkingDays(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const days = Array.from(new Set(raw.filter(isWeekday))).sort((a, b) => a - b);
  return days.length > 0 ? days : null;
}

/** Valid dates as "YYYY-MM-DD", unique and sorted, at most `MAX_HOLIDAYS` (the latest). */
export function normalizeHolidays(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const days = new Set<number>();
  for (const v of raw) {
    if (typeof v === "string" && isIsoDate(v)) days.add(isoDayNumber(v) as number);
  }
  return Array.from(days)
    .sort((a, b) => a - b)
    .slice(-MAX_HOLIDAYS)
    .map(isoFromDayNumber);
}

/**
 * A usable calendar from whatever was stored: bad weekdays and dates are
 * dropped, and no working days at all means the default week.
 */
export function normalizeCalendar(
  raw: { workingDays?: unknown; holidays?: unknown } | null | undefined
): WorkingCalendar {
  return {
    workingDays: normalizeWorkingDays(raw?.workingDays) ?? DEFAULT_WORKING_DAYS,
    holidays: normalizeHolidays(raw?.holidays),
  };
}

/** Day numbers of the holidays that fall on a working weekday. */
function holidayNumbers(calendar: WorkingCalendar, working: ReadonlySet<number>): number[] {
  const out: number[] = [];
  for (const h of calendar.holidays) {
    const n = isoDayNumber(h);
    if (n !== null && working.has(weekdayOfDayNumber(n))) out.push(n);
  }
  return Array.from(new Set(out));
}

function workingSet(calendar: WorkingCalendar): Set<number> {
  const days = normalizeWorkingDays(calendar.workingDays) ?? DEFAULT_WORKING_DAYS;
  return new Set(days);
}

/** Whether the team works on `iso`: a working weekday that isn't a holiday. */
export function isWorkingDay(iso: string, calendar: WorkingCalendar = DEFAULT_CALENDAR): boolean {
  const n = isoDayNumber(iso);
  if (n === null) return false;
  if (!workingSet(calendar).has(weekdayOfDayNumber(n))) return false;
  return !calendar.holidays.some((h) => isoDayNumber(h) === n);
}

/**
 * Working days from `from` up to, but not including, `to`: 0 when `to` is
 * not after `from`, null when either isn't a date. Constant time in the
 * length of the range (whole weeks are counted at once).
 */
export function workingDaysBetween(
  from: string,
  to: string,
  calendar: WorkingCalendar = DEFAULT_CALENDAR
): number | null {
  const a = isoDayNumber(from);
  const b = isoDayNumber(to);
  if (a === null || b === null) return null;
  return countWorkingDays(a, b, calendar);
}

/** Working days in [a, b) for UTC day numbers. */
export function countWorkingDays(
  a: number,
  b: number,
  calendar: WorkingCalendar = DEFAULT_CALENDAR
): number {
  if (b <= a) return 0;
  const working = workingSet(calendar);
  const span = b - a;
  const weeks = Math.floor(span / 7);
  let count = weeks * working.size;
  for (let n = a + weeks * 7; n < b; n++) {
    if (working.has(weekdayOfDayNumber(n))) count++;
  }
  for (const h of holidayNumbers(calendar, working)) {
    if (h >= a && h < b) count--;
  }
  return count;
}

/**
 * The date `n` working days after `from` (the morning by which `n` working
 * days are done), or null when `from` isn't a date. Counts like
 * `workingDaysBetween`: `workingDaysBetween(from, addWorkingDays(from, n)) === n`,
 * and the result is the earliest such date. `n` below 1 gives `from`.
 */
export function addWorkingDays(
  from: string,
  n: number,
  calendar: WorkingCalendar = DEFAULT_CALENDAR
): string | null {
  const a = isoDayNumber(from);
  if (a === null) return null;
  const target = Number.isFinite(n) ? Math.ceil(n) : 0;
  if (target <= 0) return isoFromDayNumber(a);
  const working = workingSet(calendar);
  const holidays = new Set(holidayNumbers(calendar, working));
  // Jump close with whole weeks, then walk. Holidays only push it later, so
  // the jump never overshoots.
  const weeks = Math.max(0, Math.floor((target - 1) / working.size));
  let day = a + weeks * 7;
  let done = countWorkingDays(a, day, calendar);
  // Every week has at least one working day, so this ends; the cap only
  // guards against a calendar whose holidays cover years.
  for (let guard = 0; done < target && guard < 100_000; guard++) {
    if (working.has(weekdayOfDayNumber(day)) && !holidays.has(day)) done++;
    day++;
  }
  return isoFromDayNumber(day);
}

/* ── Working hours ─────────────────────────────────────────────────────
 * For elapsed times shorter than a day (a pull request waiting for its
 * first review). Times are read as wall-clock: the "YYYY-MM-DD" and
 * "HH:MM" written in the value, never converted through the host's time
 * zone, so the browser and the server agree on the same stored string. */

/** Minutes in a day: a window's end may be this (midnight at the end of the day). */
const MINUTES_PER_DAY = 1440;

const WALL_CLOCK =
  /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?$/i;

/**
 * A "YYYY-MM-DD[THH:MM[:SS]]" value as its day and the minute of that day
 * (0 for a bare date; seconds are dropped), or null when it isn't one. A
 * zone suffix ("Z", "+02:00") is ignored: the written time is the one
 * counted. The date must exist ("2026-02-30" doesn't), unlike isoDayNumber.
 */
export function parseWallClock(
  value: string | null | undefined
): { day: string; minute: number } | null {
  const m = WALL_CLOCK.exec(typeof value === "string" ? value.trim() : "");
  if (!m || !isIsoDate(m[1])) return null;
  const hour = m[2] === undefined ? 0 : Number(m[2]);
  const minute = m[3] === undefined ? 0 : Number(m[3]);
  const second = m[4] === undefined ? 0 : Number(m[4]);
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { day: m[1], minute: hour * 60 + minute };
}

/** A local "HH:MM" (24-hour) as the minute of the day, or null when it isn't one. */
export function parseClockTime(value: string | null | undefined): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(typeof value === "string" ? value.trim() : "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** The part of each working day that counts, as minutes of the day: start before end. */
export interface WorkingWindowMinutes {
  startMinute: number;
  endMinute: number;
}

/**
 * Working hours from `start` to `end`: the minutes that fall on working
 * days (the calendar's weekdays, minus its holidays), clipped to `window`
 * when one is given (a whole working day counts otherwise), in hours.
 * Friday 17:00 to Monday 10:00 is 17 hours on whole days, 1 hour with a
 * 09:00–17:00 window. 0 when both are the same moment; null when either
 * isn't a wall-clock value, `end` comes before `start`, or the window isn't
 * 0 ≤ start < end ≤ 1440. Constant time in the length of the range.
 */
export function workingHoursBetween(
  start: string,
  end: string,
  calendar: WorkingCalendar = DEFAULT_CALENDAR,
  window?: WorkingWindowMinutes
): number | null {
  const a = parseWallClock(start);
  const b = parseWallClock(end);
  if (a === null || b === null) return null;
  const dayA = isoDayNumber(a.day) as number;
  const dayB = isoDayNumber(b.day) as number;
  if (dayB * MINUTES_PER_DAY + b.minute < dayA * MINUTES_PER_DAY + a.minute) return null;
  let from = 0;
  let to = MINUTES_PER_DAY;
  if (window !== undefined) {
    const { startMinute, endMinute } = window;
    if (
      !Number.isFinite(startMinute) ||
      !Number.isFinite(endMinute) ||
      startMinute < 0 ||
      endMinute > MINUTES_PER_DAY ||
      startMinute >= endMinute
    ) {
      return null;
    }
    from = startMinute;
    to = endMinute;
  }
  /** The minutes of [s, e) inside the window. */
  const clip = (s: number, e: number) => Math.max(0, Math.min(e, to) - Math.max(s, from));
  let minutes: number;
  if (dayA === dayB) {
    minutes = isWorkingDay(a.day, calendar) ? clip(a.minute, b.minute) : 0;
  } else {
    minutes =
      (isWorkingDay(a.day, calendar) ? clip(a.minute, MINUTES_PER_DAY) : 0) +
      (isWorkingDay(b.day, calendar) ? clip(0, b.minute) : 0) +
      countWorkingDays(dayA + 1, dayB, calendar) * (to - from);
  }
  return minutes / 60;
}
