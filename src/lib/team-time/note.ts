/**
 * The schedule note: what Ask Amr reads about the team's time (places,
 * shared minutes, meetings outside hours, anchor days, clock changes, and
 * never a person's name), and the note the page writes itself from the same
 * facts when AI is off. Pure and server-safe; the AI task's fallback is
 * `scheduleTips`.
 */

import type { TeamTimePerson, TeamTimeRotation } from "@/lib/stores/workspace-types";
import type { CeremonyCadence } from "@/lib/sprints/cadence";
import { WEEKDAY_LABEL } from "@/lib/sprints/cadence";
import { dayText, daysLabel, hoursText, minutesText } from "./format";
import { ceremonyTimes, meetingBurdens } from "./model";
import { anchorDaysBySite } from "./office";
import {
  bestDayMinutes,
  clockChanges,
  sharedWindows,
  weekRange,
  type ClockChange,
} from "./overlap";
import { nextOccurrences } from "./rotation";
import { localClock, offsetLabel, offsetMinutes, zoneLabel } from "./zones";

/** The note's caps, as the AI task's schemas hold them. */
export const NOTE_MAX = {
  places: 12,
  label: 60,
  hours: 11,
  days: 40,
  meetings: 8,
  meetingName: 80,
  anchorDays: 4,
  site: 60,
  clockChanges: 4,
  clockChange: 160,
  note: 600,
  tips: 4,
  tip: 200,
} as const;

/** What the note reads (the task's input). */
export interface ScheduleNoteInput {
  places: {
    label: string;
    offsetMinutes: number;
    people: number;
    hours: string;
    days: string;
  }[];
  overlapMinutes: number;
  mostOverlapMinutes: number;
  meetings: { name: string; outsideHours: number; nightOrDayOff: number }[];
  anchorDays: { site: string; days: number[] }[];
  clockChanges: string[];
}

/** The note and its tips (the task's output). */
export interface ScheduleNote {
  note: string;
  tips: string[];
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));

/** A clock change in a line: "Sun 29 Mar: London moves to UTC+1; shared time 2 h before, 1 h after." */
export function clockChangeLine(c: ClockChange, zone: string): string {
  const day = dayText(localClock(zone, c.at).day);
  const moves = c.zones
    .slice(0, 3)
    .map((z) => `${z.label} moves to ${offsetLabel(z.toOffset)}`)
    .join(", ");
  const more = c.zones.length > 3 ? ` and ${c.zones.length - 3} more` : "";
  return clip(
    `${day}: ${moves}${more}; everyone shares ${minutesText(c.before)} a day before, ${minutesText(c.after)} after.`,
    NOTE_MAX.clockChange
  );
}

/**
 * The note's input from the team: places merged by offset and office (the
 * 12 with the most people kept, east to west), the best day's shared
 * minutes, the saved cadence's ceremonies and each rotation's next meeting
 * with how many are outside their hours, the anchor days and the clock
 * changes in the next 8 weeks. Nobody's name goes in.
 */
export function scheduleNoteInput(opts: {
  people: readonly TeamTimePerson[];
  now: Date | number;
  zone: string;
  cadence: CeremonyCadence | null;
  rotations: readonly TeamTimeRotation[];
  holidays?: readonly string[];
}): ScheduleNoteInput {
  const { people, zone } = opts;
  const now = typeof opts.now === "number" ? opts.now : opts.now.getTime();
  const groups = new Map<
    string,
    { offset: number; site: string | null; cities: string[]; members: TeamTimePerson[] }
  >();
  for (const p of people) {
    const offset = offsetMinutes(p.timeZone, now);
    const site = p.site?.trim() || null;
    const key = `${offset}|${site?.toLowerCase() ?? ""}`;
    const g = groups.get(key) ?? { offset, site, cities: [], members: [] };
    const city = zoneLabel(p.timeZone);
    if (!g.cities.includes(city)) g.cities.push(city);
    g.members.push(p);
    groups.set(key, g);
  }
  const places = Array.from(groups.values())
    .sort((a, b) => b.members.length - a.members.length || b.offset - a.offset)
    .slice(0, NOTE_MAX.places)
    .sort((a, b) => b.offset - a.offset)
    .map((g) => {
      const counts = new Map<string, number>();
      for (const m of g.members) counts.set(hoursText(m), (counts.get(hoursText(m)) ?? 0) + 1);
      const hours = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
      return {
        label: clip(g.site ?? g.cities.join(", "), NOTE_MAX.label),
        offsetMinutes: clamp(g.offset, -720, 840),
        people: clamp(g.members.length, 1, 50),
        hours: hours.slice(0, NOTE_MAX.hours),
        days: clip(daysLabel(g.members.flatMap((m) => m.workingDays)), NOTE_MAX.days),
      };
    });
  const week = weekRange(zone, now);
  const shared = sharedWindows(people, week.from, week.to);
  const everyone = bestDayMinutes(shared.everyone, zone);
  const most = Math.max(everyone, bestDayMinutes(shared.allButOne, zone));
  const meetings: ScheduleNoteInput["meetings"] = [];
  const count = (start: string, minutes: number, list: readonly TeamTimePerson[]) => {
    const b = meetingBurdens(list, start, minutes);
    return {
      outsideHours: b.filter((x) => x.burden >= 1).length,
      nightOrDayOff: b.filter((x) => x.burden === 2).length,
    };
  };
  if (opts.cadence) {
    for (const c of ceremonyTimes(opts.cadence, now, zone)) {
      meetings.push({ name: c.label, ...count(c.start, c.minutes, people) });
    }
  }
  for (const r of opts.rotations) {
    const next = nextOccurrences(r, people, now, 1, { holidays: opts.holidays })[0];
    if (!next) continue;
    const b = Object.values(next.burdens);
    meetings.push({
      name: clip(r.meeting, NOTE_MAX.meetingName),
      outsideHours: b.filter((x) => x >= 1).length,
      nightOrDayOff: b.filter((x) => x === 2).length,
    });
  }
  return {
    places,
    overlapMinutes: clamp(everyone, 0, 1440),
    mostOverlapMinutes: clamp(most, 0, 1440),
    meetings: meetings.slice(0, NOTE_MAX.meetings),
    anchorDays: anchorDaysBySite(people)
      .slice(0, NOTE_MAX.anchorDays)
      .map((a) => ({ site: clip(a.site, NOTE_MAX.site), days: a.days.slice(0, 7) })),
    clockChanges: clockChanges(people, now, 8, zone)
      .slice(0, NOTE_MAX.clockChanges)
      .map((c) => clockChangeLine(c, zone)),
  };
}

const hoursApart = (minutes: number) => {
  const h = minutes / 60;
  return Number.isInteger(h) ? `${h} hour${h === 1 ? "" : "s"}` : `${h.toFixed(1)} hours`;
};

/**
 * The note without AI, from the same facts: where the team is and how much
 * it shares, then up to four tips. 3 hours or more shared: keep the
 * meetings inside it; 1 to 3 hours: the Daily Scrum and quick questions
 * inside it, longer sessions in writing; under an hour: the written
 * standup, and rotate what must be live. Then a meeting that lands at night
 * or on a day off, the next clock change and an anchor day. Throws on an
 * input with no places (nothing to say).
 */
export function scheduleTips(input: ScheduleNoteInput): ScheduleNote {
  if (!input.places || input.places.length === 0) {
    throw new Error("Add the team's time zones first.");
  }
  const east = input.places.reduce((a, b) => (b.offsetMinutes > a.offsetMinutes ? b : a));
  const west = input.places.reduce((a, b) => (b.offsetMinutes < a.offsetMinutes ? b : a));
  const spread = east.offsetMinutes - west.offsetMinutes;
  const people = input.places.reduce((n, p) => n + p.people, 0);
  const shared = input.overlapMinutes;
  const where =
    input.places.length === 1
      ? `The team works in one place, ${east.label}.`
      : `The team works in ${input.places.length} places, from ${east.label} to ${west.label}, ${hoursApart(spread)} apart.`;
  const overlap =
    people <= 1
      ? "Add more people to see the hours you share."
      : shared > 0
        ? `Everyone shares ${minutesText(shared)} on the best day.`
        : input.mostOverlapMinutes > 0
          ? `No hour covers everyone; all but one share ${minutesText(input.mostOverlapMinutes)} on the best day.`
          : "No hour covers everyone.";
  const tips: string[] = [];
  if (shared >= 180) {
    tips.push("Keep the team's meetings inside the shared hours, and protect the rest for focus.");
  } else if (shared >= 60) {
    tips.push(
      "Fit the Daily Scrum and quick questions inside the shared hours, and move longer sessions into writing."
    );
  } else {
    tips.push(
      "Use the written standup for the Daily Scrum, and rotate the meetings that must be live so the late calls are shared."
    );
  }
  for (const m of input.meetings) {
    if (tips.length >= 3) break;
    if (m.nightOrDayOff > 0) {
      tips.push(
        `Rotate ${m.name}: it lands at night or on a day off for ${m.nightOrDayOff} ${m.nightOrDayOff === 1 ? "person" : "people"}.`
      );
    }
  }
  if (input.clockChanges[0] && tips.length < NOTE_MAX.tips) {
    tips.push(`Check the shared hours again after the clock change. ${input.clockChanges[0]}`);
  }
  const anchor = input.anchorDays.find((a) => a.days.length > 0);
  if (anchor && tips.length < NOTE_MAX.tips) {
    tips.push(
      `Plan in-person work at ${anchor.site} on ${anchor.days.map((d) => WEEKDAY_LABEL[d]).join(" or ")}, the day most people are in.`
    );
  }
  return {
    note: clip(`${where} ${overlap}`, NOTE_MAX.note),
    tips: tips.slice(0, NOTE_MAX.tips).map((t) => clip(t, NOTE_MAX.tip)),
  };
}
