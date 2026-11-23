/**
 * The hours a team shares: each person's working hours as real instants
 * (their zone's clock on the real dates, so a clock change lands where it
 * does), then a sweep for the windows when everyone is working and when all
 * but one are (and who is left out), and the clock changes coming up. Pure
 * and server-safe; Working Agreement's core-hours template reads the same.
 *
 * Instants are epoch milliseconds. A shift whose end is earlier than its
 * start runs past midnight and belongs to the day it starts.
 */

import { isoDayNumber, isoFromDayNumber, weekdayOf } from "@/lib/sprints/calendar";
import type { CoreHoursTemplate, TeamTimePerson } from "@/lib/stores/workspace-types";
import { clockText, minuteOf } from "./format";
import { localClock, offsetMinutes, wallToUtc, zoneLabel } from "./zones";

export const MINUTE_MS = 60_000;
export const DAY_MS = 86_400_000;
export const WEEK_MS = 7 * DAY_MS;

/** A span of time, [start, end) in epoch milliseconds. */
export interface Interval {
  start: number;
  end: number;
}

type Hours = Pick<TeamTimePerson, "timeZone" | "start" | "end" | "workingDays">;

/** Sorted and joined where they touch or overlap. */
export function mergeIntervals(list: readonly Interval[]): Interval[] {
  const sorted = list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

/** The local days a clock in `zone` passes through from `from` to `to`, a day either side. */
export function localDaysAround(zone: string, from: number, to: number): string[] {
  const first = isoDayNumber(localClock(zone, from).day);
  const last = isoDayNumber(localClock(zone, Math.max(from, to - 1)).day);
  if (first === null || last === null) return [];
  const days: string[] = [];
  for (let d = first - 1; d <= last + 1; d++) days.push(isoFromDayNumber(d));
  return days;
}

/**
 * One shift on `day` (its start on that day, its end the same day or, for
 * a night shift, the next), or null when the day isn't a working day.
 */
export function shiftOn(person: Hours, day: string): Interval | null {
  const weekday = weekdayOf(day);
  if (weekday === null || !person.workingDays.includes(weekday)) return null;
  const s = minuteOf(person.start);
  const e = minuteOf(person.end);
  if (s === null || e === null || s === e) return null;
  const start = wallToUtc(day, person.start, person.timeZone);
  const dayNumber = isoDayNumber(day);
  if (!start || dayNumber === null) return null;
  const endDay = e > s ? day : isoFromDayNumber(dayNumber + 1);
  const end = wallToUtc(endDay, person.end, person.timeZone);
  if (!end || end.getTime() <= start.getTime()) return null;
  return { start: start.getTime(), end: end.getTime() };
}

/** A person's working hours from `from` to `to`, as instants, cut to the range. */
export function workIntervals(person: Hours, from: number, to: number): Interval[] {
  const out: Interval[] = [];
  for (const day of localDaysAround(person.timeZone, from, to)) {
    const shift = shiftOn(person, day);
    if (!shift) continue;
    const start = Math.max(shift.start, from);
    const end = Math.min(shift.end, to);
    if (end > start) out.push({ start, end });
  }
  return mergeIntervals(out);
}

/** A window of shared time: everyone in, or everyone but `leftOut` (a person id). */
export interface SharedWindow extends Interval {
  /** Null: everyone is in. */
  leftOut: string | null;
}

export interface SharedHours {
  /** When everyone is working. */
  everyone: SharedWindow[];
  /** When all but one are working, with who is left out (only with 3 people or more). */
  allButOne: SharedWindow[];
}

/**
 * When the people's working hours overlap from `from` to `to`: the windows
 * with everyone in, and with all but one in (who is left out), in time
 * order. Nobody gives no windows; one person, their own hours.
 */
export function sharedWindows(
  people: readonly (Hours & { id: string })[],
  from: number,
  to: number
): SharedHours {
  if (people.length === 0 || to <= from) return { everyone: [], allButOne: [] };
  const events: { at: number; id: string; delta: 1 | -1 }[] = [];
  for (const p of people) {
    for (const i of workIntervals(p, from, to)) {
      events.push({ at: i.start, id: p.id, delta: 1 }, { at: i.end, id: p.id, delta: -1 });
    }
  }
  // Ends before starts at the same instant: a hand-over isn't an overlap.
  events.sort((a, b) => a.at - b.at || a.delta - b.delta);
  const n = people.length;
  const inNow = new Map<string, number>();
  const everyone: SharedWindow[] = [];
  const allButOne: SharedWindow[] = [];
  const push = (list: SharedWindow[], start: number, end: number, leftOut: string | null) => {
    if (end <= start) return;
    const last = list[list.length - 1];
    if (last && last.end === start && last.leftOut === leftOut) last.end = end;
    else list.push({ start, end, leftOut });
  };
  for (let k = 0; k < events.length; k++) {
    const e = events[k];
    inNow.set(e.id, (inNow.get(e.id) ?? 0) + e.delta);
    if ((inNow.get(e.id) ?? 0) <= 0) inNow.delete(e.id);
    const next = events[k + 1]?.at;
    if (next === undefined || next === e.at) continue;
    if (inNow.size === n) push(everyone, e.at, next, null);
    else if (n >= 3 && inNow.size === n - 1) {
      const missing = people.find((p) => !inNow.has(p.id));
      if (missing) push(allButOne, e.at, next, missing.id);
    }
  }
  return { everyone, allButOne };
}

/** A week on a clock in `zone`: Monday 00:00 to the next Monday, `offset` weeks from now. */
export interface WeekRange {
  from: number;
  to: number;
  /** The seven days, Monday first, "YYYY-MM-DD". */
  days: string[];
}

export function weekRange(zone: string, now: Date | number, offset = 0): WeekRange {
  const today = localClock(zone, now);
  const todayNumber = isoDayNumber(today.day) ?? 0;
  const monday = todayNumber - ((today.weekday + 6) % 7) + 7 * Math.trunc(offset);
  const days = Array.from({ length: 7 }, (_, i) => isoFromDayNumber(monday + i));
  const from = wallToUtc(days[0], "00:00", zone)?.getTime() ?? monday * DAY_MS;
  const to = wallToUtc(isoFromDayNumber(monday + 7), "00:00", zone)?.getTime() ?? from + WEEK_MS;
  return { from, to, days };
}

/** One line of the shared-hours list: a window as a clock in the display zone reads it, and its days. */
export interface WindowLine {
  /** "HH:MM" in the display zone. */
  start: string;
  end: string;
  /** Weekdays it falls on, as the display zone counts them (its start's day). */
  days: number[];
  /** Its length on one day. */
  minutes: number;
  leftOut: string | null;
}

/**
 * The windows as lines for a clock in `zone`: windows at the same local
 * time on several days share a line ("13:00–14:00, Mon–Thu"). Lines are in
 * the order of their first day.
 */
export function windowLines(windows: readonly SharedWindow[], zone: string): WindowLine[] {
  const lines = new Map<string, WindowLine>();
  const first = new Map<string, number>();
  for (const w of windows) {
    const a = localClock(zone, w.start);
    const b = localClock(zone, w.end);
    const start = clockText(a.minute);
    const end = clockText(b.minute === 0 && b.day !== a.day ? 1440 : b.minute);
    const key = `${start}|${end}|${w.leftOut ?? ""}`;
    const line = lines.get(key);
    if (line) {
      if (!line.days.includes(a.weekday)) line.days.push(a.weekday);
      continue;
    }
    first.set(key, w.start);
    lines.set(key, {
      start,
      end,
      days: [a.weekday],
      minutes: Math.round((w.end - w.start) / MINUTE_MS),
      leftOut: w.leftOut,
    });
  }
  return Array.from(lines.entries())
    .sort((x, y) => (first.get(x[0]) ?? 0) - (first.get(y[0]) ?? 0))
    .map(([, line]) => ({ ...line, days: [...line.days].sort((p, q) => p - q) }));
}

/**
 * The most shared minutes on any one day, as a clock in `zone` counts days
 * (a window is counted on the day it starts): 0 with no windows.
 */
export function bestDayMinutes(windows: readonly Interval[], zone: string): number {
  const byDay = new Map<string, number>();
  for (const w of windows) {
    const day = localClock(zone, w.start).day;
    byDay.set(day, (byDay.get(day) ?? 0) + Math.round((w.end - w.start) / MINUTE_MS));
  }
  return byDay.size === 0 ? 0 : Math.max(...Array.from(byDay.values()));
}

/** The longest shared window this week and how it reads in `zone`, or null. */
export interface BestWindow {
  kind: "everyone" | "all-but-one";
  /** "HH:MM" in the zone asked for. */
  start: string;
  end: string;
  /** The weekdays the same window comes back on. */
  days: number[];
  minutes: number;
  /** Who is left out (a person id), for "all-but-one". */
  leftOut: string | null;
}

/**
 * The week's best shared window as a clock in `zone` reads it: the
 * everyone-window that comes back on the most days (then the longest),
 * else the same among the all-but-one windows; null with neither.
 */
export function bestSharedWindow(
  people: readonly (Hours & { id: string })[],
  zone: string,
  now: Date | number
): BestWindow | null {
  const week = weekRange(zone, now);
  const shared = sharedWindows(people, week.from, week.to);
  const pick = (windows: SharedWindow[], kind: BestWindow["kind"]): BestWindow | null => {
    const lines = windowLines(windows, zone);
    if (lines.length === 0) return null;
    const best = [...lines].sort(
      (a, b) => b.days.length - a.days.length || b.minutes - a.minutes
    )[0];
    return {
      kind,
      start: best.start,
      end: best.end,
      days: best.days,
      minutes: best.minutes,
      leftOut: best.leftOut,
    };
  };
  return pick(shared.everyone, "everyone") ?? pick(shared.allButOne, "all-but-one");
}

/**
 * The Working Agreement's core hours from `from` to `to`, as instants (its
 * start and end on its days, on its zone's clock), for the band on the
 * strips. Empty when the template has no usable times or zone.
 */
export function coreHoursIntervals(
  core: Pick<CoreHoursTemplate, "start" | "end" | "timeZone" | "days">,
  from: number,
  to: number
): Interval[] {
  if (!core.timeZone || minuteOf(core.start) === null || minuteOf(core.end) === null) return [];
  try {
    return workIntervals(
      { timeZone: core.timeZone, start: core.start, end: core.end, workingDays: core.days },
      from,
      to
    );
  } catch {
    return [];
  }
}

/** A coming clock change: when, which zones move and by how much, and the shared time either side. */
export interface ClockChange {
  /** The instant the clocks change. */
  at: number;
  zones: { zone: string; label: string; fromOffset: number; toOffset: number }[];
  /** People in those zones (ids). */
  people: string[];
  /** The most minutes everyone shares on one day, in the week before the change and the week after. */
  before: number;
  after: number;
}

/** The instant in [lo, hi] where `zone`'s offset first differs from its offset at `lo`. */
function changeBetween(zone: string, lo: number, hi: number): number {
  const was = offsetMinutes(zone, lo);
  while (hi - lo > MINUTE_MS) {
    const mid = Math.floor((lo + hi) / 2 / MINUTE_MS) * MINUTE_MS;
    if (offsetMinutes(zone, mid) === was) lo = mid;
    else hi = mid;
  }
  return hi;
}

/**
 * The clock changes in the people's zones over the next `weeks` weeks, in
 * time order, zones that change at the same instant together, each with the
 * most everyone-shared minutes on a day in the week before it and after it.
 * `zone` counts the days (the viewer's).
 */
export function clockChanges(
  people: readonly (Hours & { id: string })[],
  from: Date | number,
  weeks = 8,
  zone = "UTC"
): ClockChange[] {
  const start = typeof from === "number" ? from : from.getTime();
  const end = start + weeks * WEEK_MS;
  const zones = Array.from(new Set(people.map((p) => p.timeZone)));
  const found = new Map<number, ClockChange>();
  for (const z of zones) {
    let t = start;
    let was = offsetMinutes(z, t);
    while (t < end) {
      const next = Math.min(t + DAY_MS, end);
      const now = offsetMinutes(z, next);
      if (now !== was) {
        const at = changeBetween(z, t, next);
        const change = found.get(at) ?? { at, zones: [], people: [], before: 0, after: 0 };
        change.zones.push({ zone: z, label: zoneLabel(z), fromOffset: was, toOffset: now });
        for (const p of people) if (p.timeZone === z) change.people.push(p.id);
        found.set(at, change);
        was = now;
      }
      t = next;
    }
  }
  return Array.from(found.values())
    .sort((a, b) => a.at - b.at)
    .map((c) => ({
      ...c,
      before: bestDayMinutes(sharedWindows(people, c.at - WEEK_MS, c.at).everyone, zone),
      after: bestDayMinutes(sharedWindows(people, c.at, c.at + WEEK_MS).everyone, zone),
    }));
}
