/**
 * Z.AI's peak window, worked out the same way as visitor_ai_meter (migration
 * 0037): Monday to Friday, 14:00-18:00 Singapore time by default. Singapore
 * has no daylight saving, so the window is the same instant all year, which is
 * 08:00-12:00 in Cairo in winter and 09:00-13:00 in summer.
 *
 * The server's meter is what counts; this is for the visitor panel's note
 * ("Busy hours until 12:00"), shown in the visitor's own time zone. Pure and
 * browser-safe: plain Intl, no imports.
 */

export interface PeakConfig {
  /** IANA zone the window is defined in. */
  tz: string;
  /** ISO weekdays the window runs on (1 = Monday … 7 = Sunday). */
  days: readonly number[];
  /** First hour of the window in `tz` (0-24). */
  start: number;
  /** Hour the window ends in `tz`, exclusive (0-24). */
  end: number;
}

/** visitor_ai_config's defaults. */
export const DEFAULT_PEAK: PeakConfig = {
  tz: "Asia/Singapore",
  days: [1, 2, 3, 4, 5],
  start: 14,
  end: 18,
};

export interface PeakWindow {
  /** The window is on at the given instant. */
  on: boolean;
  /** When the current window ends (null when it isn't on). */
  endsAt: Date | null;
  /** When the next window that hasn't started yet starts (null if the config has none). */
  nextStart: Date | null;
  /** When that next window ends (null with nextStart). */
  nextEnd: Date | null;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** One cached formatter per zone: building them is the slow part. */
function wallFormatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hourCycle: "h23",
    });
    formatters.set(tz, f);
  }
  return f;
}

/** The wall-clock reading in `tz` at `date`. */
function wallClock(date: Date, tz: string): WallClock & { second: number } {
  const parts = wallFormatter(tz).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    // Some engines still say "24" for midnight under h23.
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/** How far `tz` is ahead of UTC at `ms`, in milliseconds. */
function zoneOffsetMs(ms: number, tz: string): number {
  const w = wallClock(new Date(ms), tz);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * The instant a wall-clock time in `tz` happens. Out-of-range fields roll over
 * the way Date.UTC rolls them (hour 24 is the next day's 00:00). In a
 * daylight-saving gap or overlap it picks one of the readings, which is fine
 * for a whole-hour note.
 */
function zonedInstant(
  tz: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = zoneOffsetMs(guess, tz);
  let t = guess - first;
  const second = zoneOffsetMs(t, tz);
  if (second !== first) t = guess - second;
  return new Date(t);
}

/** ISO weekday (1 = Monday … 7 = Sunday) of a calendar date. */
function isoWeekday(year: number, month: number, day: number): number {
  const d = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return d === 0 ? 7 : d;
}

/** A config that can never be on (no days, or an empty span of hours). */
function isEmpty(cfg: PeakConfig): boolean {
  return cfg.days.length === 0 || cfg.start >= cfg.end;
}

/** Whether the peak window is on at `date`. */
export function isPeak(date: Date = new Date(), cfg: PeakConfig = DEFAULT_PEAK): boolean {
  if (isEmpty(cfg)) return false;
  const w = wallClock(date, cfg.tz);
  return (
    cfg.days.includes(isoWeekday(w.year, w.month, w.day)) && w.hour >= cfg.start && w.hour < cfg.end
  );
}

/** Whether the window is on at `date`, when it ends, and when the next one runs. */
export function peakWindow(date: Date = new Date(), cfg: PeakConfig = DEFAULT_PEAK): PeakWindow {
  if (isEmpty(cfg)) return { on: false, endsAt: null, nextStart: null, nextEnd: null };
  const w = wallClock(date, cfg.tz);
  const on = isPeak(date, cfg);
  const endsAt = on ? zonedInstant(cfg.tz, w.year, w.month, w.day, cfg.end) : null;

  // Today's window counts as "next" only while it hasn't started yet.
  for (let k = w.hour < cfg.start ? 0 : 1; k <= 7; k++) {
    // Date.UTC normalises day overflow (31 + 1 → the 1st of next month).
    const d = new Date(Date.UTC(w.year, w.month - 1, w.day + k));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    if (!cfg.days.includes(isoWeekday(y, m, day))) continue;
    return {
      on,
      endsAt,
      nextStart: zonedInstant(cfg.tz, y, m, day, cfg.start),
      nextEnd: zonedInstant(cfg.tz, y, m, day, cfg.end),
    };
  }
  return { on, endsAt, nextStart: null, nextEnd: null };
}

/**
 * A time as "08:00" (24-hour) in `timeZone`, the visitor's own when left out.
 * `locale` picks the digits and separator; the browser's when left out.
 */
export function formatPeakTime(date: Date, timeZone?: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

/** A window as "08:00–12:00" in `timeZone`, the visitor's own when left out. */
export function formatPeakRange(
  start: Date,
  end: Date,
  timeZone?: string,
  locale?: string
): string {
  return `${formatPeakTime(start, timeZone, locale)}–${formatPeakTime(end, timeZone, locale)}`;
}
