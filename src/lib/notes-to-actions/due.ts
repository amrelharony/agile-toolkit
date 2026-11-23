/**
 * The due date a line of meeting notes names, as a day (YYYY-MM-DD): "by
 * Friday", "by 12 Nov", "Nov 12", an ISO day, "tomorrow", "today", "end of
 * the week" and "end of sprint" (the running sprint's last day, when the
 * page knows it). Counted from the meeting's day, never the clock, so a
 * note read a week later still means the same day. A named day that has
 * already passed this year means next year's. Pure, and calendar maths
 * only: days are counted in UTC, so no time zone moves them.
 */

const WEEKDAYS = [
  ["sunday", "sun"],
  ["monday", "mon"],
  ["tuesday", "tue", "tues"],
  ["wednesday", "wed"],
  ["thursday", "thu", "thur", "thurs"],
  ["friday", "fri"],
  ["saturday", "sat"],
] as const;

const MONTHS = [
  ["january", "jan"],
  ["february", "feb"],
  ["march", "mar"],
  ["april", "apr"],
  ["may"],
  ["june", "jun"],
  ["july", "jul"],
  ["august", "aug"],
  ["september", "sep", "sept"],
  ["october", "oct"],
  ["november", "nov"],
  ["december", "dec"],
] as const;

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether `day` is a real YYYY-MM-DD day. */
export function isDay(day: string | undefined): day is string {
  if (!day) return false;
  const m = ISO_DAY.exec(day);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

const toTime = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromTime = (t: number) => new Date(t).toISOString().slice(0, 10);

/** `day` moved by `n` days. */
export function shiftDay(day: string, n: number): string {
  return fromTime(toTime(day) + n * 86_400_000);
}

/** The day of the week of `day`, 0 Sunday to 6 Saturday. */
const weekdayOf = (day: string) => new Date(toTime(day)).getUTCDay();

/** The first `weekday` on or after `from`. */
function nextWeekday(from: string, weekday: number): string {
  return shiftDay(from, (weekday - weekdayOf(from) + 7) % 7);
}

/** A real day `year-month-date`, or null. */
function dayOf(year: number, month: number, date: number): string | null {
  const day = `${year}-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
  return isDay(day) ? day : null;
}

/** A month or date named without a year: this year's, or next year's once it has passed. */
function upcoming(today: string, month: number, date: number): string | null {
  const year = Number(today.slice(0, 4));
  const thisYear = dayOf(year, month, date);
  if (thisYear && thisYear >= today) return thisYear;
  return dayOf(year + 1, month, date) ?? thisYear;
}

const monthIndex = (word: string) =>
  MONTHS.findIndex((names) => (names as readonly string[]).includes(word.toLowerCase()));
const weekdayIndex = (word: string) =>
  WEEKDAYS.findIndex((names) => (names as readonly string[]).includes(word.toLowerCase()));

const MONTH_WORD = MONTHS.flat().join("|");
const WEEKDAY_WORD = WEEKDAYS.flat().join("|");

export interface DueOptions {
  /** The running sprint's last day, for "end of sprint". */
  sprintEnd?: string;
}

/**
 * The day `text` says something is due, counted from `today` (the
 * meeting's day), or undefined when it names none. Only days on or after
 * `today` come back.
 */
export function dueFromText(
  text: string,
  today: string,
  opts: DueOptions = {}
): string | undefined {
  if (!isDay(today)) return undefined;
  const t = text.toLowerCase();
  const ok = (day: string | null | undefined) =>
    day && isDay(day) && day >= today ? day : undefined;

  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(t);
  if (iso) return ok(iso[1]);

  if (/\bend of (?:the )?sprint\b/.test(t)) return ok(opts.sprintEnd);
  if (/\btomorrow\b/.test(t)) return shiftDay(today, 1);
  if (/\b(?:today|end of (?:the )?day|eod)\b/.test(t)) return today;
  if (/\bend of (?:the |this )?week\b/.test(t)) return nextWeekday(today, 5);
  // Next week: its Monday.
  if (/\bnext week\b/.test(t)) return nextWeekday(shiftDay(today, 1), 1);

  // "12 Nov", "12th November 2026", "on the 3rd of March".
  const dm = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?(?: of)? (${MONTH_WORD})\\.?(?:,? (\\d{4}))?\\b`
  ).exec(t);
  if (dm) {
    const month = monthIndex(dm[2]) + 1;
    const date = Number(dm[1]);
    return ok(dm[3] ? dayOf(Number(dm[3]), month, date) : upcoming(today, month, date));
  }
  // "Nov 12", "November 12th, 2026".
  const md = new RegExp(
    `\\b(${MONTH_WORD})\\.? (\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}))?\\b`
  ).exec(t);
  if (md) {
    const month = monthIndex(md[1]) + 1;
    const date = Number(md[2]);
    return ok(md[3] ? dayOf(Number(md[3]), month, date) : upcoming(today, month, date));
  }
  // "by Friday", "on Mon", "before Thursday": the first on or after the
  // meeting's day. "next Tuesday": the one in the week after the meeting's.
  const wd = new RegExp(`\\b(by|on|before|until|till|next|this) (${WEEKDAY_WORD})\\b`).exec(t);
  if (wd) {
    const weekday = weekdayIndex(wd[2]);
    const nextMonday = shiftDay(today, 7 - ((weekdayOf(today) + 6) % 7));
    return nextWeekday(wd[1] === "next" ? nextMonday : today, weekday);
  }
  return undefined;
}
