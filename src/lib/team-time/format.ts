/**
 * Team Time's words for times and days: "13:00", "Mon–Thu", "Tue 14:00",
 * "Tue 18 Nov 14:00 UTC". Pure and server-safe; the page, its Markdown,
 * Amr's verbs and the AI input all say times the same way.
 */

import { WEEKDAY_LABEL } from "@/lib/sprints/cadence";
import type { TeamMember, TeamTimePerson } from "@/lib/stores/workspace-types";
import { localClock, zoneLabel } from "./zones";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (n: number) => String(n).padStart(2, "0");

/** A minute of the day as "HH:MM" (1440 reads "24:00", the end of a day). */
export function clockText(minute: number): string {
  const m = ((Math.round(minute) % 1440) + 1440) % 1440;
  if (minute === 1440) return "24:00";
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** "HH:MM" as the minute of the day, or null. */
export function minuteOf(time: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** A length in minutes as people say it: "45 min", "2 h", "1 h 30". */
export function minutesText(minutes: number): string {
  const n = Math.max(0, Math.round(minutes));
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m === 0 ? `${h} h` : `${h} h ${m}`;
}

/**
 * Weekdays in words, runs joined: [1,2,3,4] "Mon–Thu", [0,1,2,3,4] "Sun–Thu",
 * [1,3] "Mon, Wed", all seven "every day", none "no days".
 */
export function daysLabel(days: readonly number[]): string {
  const set = new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6));
  if (set.size === 0) return "no days";
  if (set.size === 7) return "every day";
  const runs: [number, number][] = [];
  for (let d = 0; d < 7; d++) {
    if (!set.has(d) || set.has((d + 6) % 7)) continue;
    let end = d;
    while (set.has((end + 1) % 7)) end = (end + 1) % 7;
    runs.push([d, end]);
  }
  // Monday-first, as calendars print the week, a run from Sunday first of all.
  const order = (d: number) => (d === 0 ? -1 : d);
  runs.sort((a, b) => order(a[0]) - order(b[0]));
  return runs
    .map(([a, b]) => {
      if (a === b) return WEEKDAY_LABEL[a];
      const length = (b - a + 7) % 7;
      return length === 1
        ? `${WEEKDAY_LABEL[a]}, ${WEEKDAY_LABEL[b]}`
        : `${WEEKDAY_LABEL[a]}–${WEEKDAY_LABEL[b]}`;
    })
    .join(", ");
}

/** A person's hours as they read them: "09:00–17:30". */
export function hoursText(p: Pick<TeamTimePerson, "start" | "end">): string {
  return `${p.start}–${p.end}`;
}

/** An instant on a clock in `zone`: "Tue 14:00". */
export function localTimeText(zone: string, at: Date | number): string {
  const c = localClock(zone, at);
  return `${WEEKDAY_LABEL[c.weekday]} ${clockText(c.minute)}`;
}

/** A day as "Tue 18 Nov". */
export function dayText(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!m) return day;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return `${WEEKDAY_LABEL[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

/** An instant on a clock in `zone`, with its date: "Tue 18 Nov 14:00". */
export function localDateTimeText(zone: string, at: Date | number): string {
  const c = localClock(zone, at);
  return `${dayText(c.day)} ${clockText(c.minute)}`;
}

/**
 * A slot as everyone reads the same: "Tue 18 Nov 14:00 UTC" (at most 21
 * characters, inside the 30 a Quick Vote option takes).
 */
export function slotLabel(start: string | Date | number): string {
  const t = new Date(start);
  if (Number.isNaN(t.getTime())) return "";
  return `${WEEKDAY_LABEL[t.getUTCDay()]} ${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} ${pad(
    t.getUTCHours()
  )}:${pad(t.getUTCMinutes())} UTC`;
}

/** The name the page shows for a person: the roster's current name, else the stored one. */
export function personName(
  p: Pick<TeamTimePerson, "teamMemberId" | "name">,
  roster: readonly Pick<TeamMember, "id" | "name">[]
): string {
  const member = p.teamMemberId ? roster.find((m) => m.id === p.teamMemberId) : undefined;
  return (member?.name ?? p.name).trim() || p.name;
}

/** Where a person is, in words: their site, else their zone's city. */
export function placeLabel(p: Pick<TeamTimePerson, "site" | "timeZone">): string {
  return p.site?.trim() || zoneLabel(p.timeZone);
}

/** Names as a list: "Lee", "Lee and Dev", "Lee, Dev and Sam". */
export function namesList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
