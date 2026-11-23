/**
 * The owner's History by recency: the groups its list shows, in order, and
 * each thread's time line in words (design §1.2 "History": rows grouped, with
 * <time> and spelled-out labels).
 *
 *   Today        "Just now", "5 minutes ago", "2 hours ago"
 *   Yesterday    the time of day, in the reader's own format ("9:05 AM")
 *   Last 7 days  the weekday ("Tuesday")
 *   Earlier      the date ("November 1"), with the year when it isn't this one
 *
 * Days are the reader's calendar days, in their own time zone, so a thread
 * from 23:50 last night is Yesterday at 00:10. A time a little ahead of the
 * clock (another device's) reads "Just now". Pure: `now` comes in, so tests
 * and the list agree on one moment.
 *
 * Owner only: History's list (components/agent/conversation-list) is its one
 * reader, inside the owner's chunk.
 */

import type { ConversationMeta } from "./types";

export type HistoryGroupKey = "today" | "yesterday" | "week" | "earlier";

/** Each group's heading, in the order the list shows them. */
export const HISTORY_GROUPS: readonly { key: HistoryGroupKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "Last 7 days" },
  { key: "earlier", label: "Earlier" },
];

export interface HistoryGroup {
  key: HistoryGroupKey;
  label: string;
  /** The group's threads, in the order they came (newest first, as History reads them). */
  threads: ConversationMeta[];
}

const DAY_MS = 86_400_000;

/** Midnight of a date's own day, in the reader's time zone. */
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Whole calendar days from `at` to `now` (0 today, 1 yesterday; below 0 for a day ahead). */
export function daysAgo(at: Date, now: Date): number {
  // Rounded: a day the clocks change in is 23 or 25 hours long.
  return Math.round((dayStart(now) - dayStart(at)) / DAY_MS);
}

function groupOf(at: Date, now: Date): HistoryGroupKey {
  const ago = daysAgo(at, now);
  if (ago <= 0) return "today";
  if (ago === 1) return "yesterday";
  if (ago < 7) return "week";
  return "earlier";
}

/**
 * The threads under their headings, in HISTORY_GROUPS order, each group
 * keeping the threads' own order; a group with none is left out. A thread
 * whose time can't be read goes under Earlier.
 */
export function historyGroups(
  threads: readonly ConversationMeta[],
  now: Date = new Date()
): HistoryGroup[] {
  const by = new Map<HistoryGroupKey, ConversationMeta[]>();
  for (const c of threads) {
    const at = new Date(c.lastMessageAt);
    const key = Number.isNaN(at.getTime()) ? "earlier" : groupOf(at, now);
    const list = by.get(key);
    if (list) list.push(c);
    else by.set(key, [c]);
  }
  return HISTORY_GROUPS.flatMap(({ key, label }) => {
    const list = by.get(key);
    return list ? [{ key, label, threads: list }] : [];
  });
}

// Each formatter is built once, on first use: toLocale*String with options
// builds a new ICU formatter on every call (tens of microseconds), and History
// formats every row on each keystroke in its search or rename field.
let timeFmt: Intl.DateTimeFormat | undefined;
let weekdayFmt: Intl.DateTimeFormat | undefined;
let monthDayFmt: Intl.DateTimeFormat | undefined;
let monthDayYearFmt: Intl.DateTimeFormat | undefined;
const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, o);

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;

/**
 * A thread's last message time, in words that fit its group (file comment).
 * Empty when the time can't be read.
 */
export function threadTime(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const ago = daysAgo(at, now);
  if (ago <= 0) {
    const mins = Math.floor((now.getTime() - at.getTime()) / 60_000);
    if (mins < 1) return "Just now";
    if (mins < 60) return plural(mins, "minute");
    return plural(Math.floor(mins / 60), "hour");
  }
  if (ago === 1) return (timeFmt ??= fmt({ hour: "numeric", minute: "2-digit" })).format(at);
  if (ago < 7) return (weekdayFmt ??= fmt({ weekday: "long" })).format(at);
  return at.getFullYear() === now.getFullYear()
    ? (monthDayFmt ??= fmt({ month: "long", day: "numeric" })).format(at)
    : (monthDayYearFmt ??= fmt({ month: "long", day: "numeric", year: "numeric" })).format(at);
}
