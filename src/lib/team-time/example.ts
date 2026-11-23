/**
 * Team Time's example: the Standup example's checkout team, under the same
 * names, spread from Toronto to Sydney, with a poll for the Sprint Review's
 * time and a Retro that rotates between a Europe morning and an Americas
 * afternoon. The page keeps it in memory only: nothing in it reaches the
 * workspace. Pure (the tool folder's example.ts re-exports it, and the
 * Standup's hand-over places read its people).
 *
 * Everyone but Lee shares 13:00–14:00 UTC, Monday to Thursday (Ana works
 * Sunday to Thursday), and the London office's anchor day is Thursday.
 */

import { isoDayNumber, isoFromDayNumber, weekdayOf } from "@/lib/sprints/calendar";
import type {
  TeamMember,
  TeamTimePerson,
  TeamTimePoll,
  TeamTimeRotation,
} from "@/lib/stores/workspace-types";
import { exampleId } from "@/lib/utils/example-id";
import { canonicalZone } from "./zones";

export interface TeamTimeExample {
  roster: TeamMember[];
  people: TeamTimePerson[];
  polls: TeamTimePoll[];
  rotations: TeamTimeRotation[];
}

interface ExamplePlace {
  key: string;
  name: string;
  role: string;
  timeZone: string;
  start: string;
  end: string;
  workingDays: number[];
  officeDays?: number[];
  site?: string;
}

const MON_FRI = [1, 2, 3, 4, 5];

const PLACES: ExamplePlace[] = [
  {
    key: "priya",
    name: "Priya (PM)",
    role: "Product Owner",
    timeZone: "Europe/London",
    start: "09:00",
    end: "17:30",
    workingDays: MON_FRI,
    officeDays: [2, 4],
    site: "London office",
  },
  {
    key: "ana",
    name: "Ana (Backend)",
    role: "Developer",
    timeZone: "Africa/Cairo",
    start: "09:00",
    end: "17:00",
    workingDays: [0, 1, 2, 3, 4],
  },
  {
    key: "sam",
    name: "Sam (QA)",
    role: "Developer",
    timeZone: "America/Toronto",
    start: "08:00",
    end: "16:00",
    workingDays: MON_FRI,
  },
  {
    key: "lee",
    name: "Lee (iOS)",
    role: "Developer",
    timeZone: "Australia/Sydney",
    start: "07:00",
    end: "15:00",
    workingDays: MON_FRI,
  },
  {
    key: "dev",
    name: "Dev (Android)",
    role: "Developer",
    timeZone: "Asia/Kolkata",
    start: "11:00",
    end: "19:30",
    workingDays: MON_FRI,
    site: "Bengaluru",
  },
  {
    key: "mia",
    name: "Mia (Design)",
    role: "Designer",
    timeZone: "Europe/London",
    start: "09:00",
    end: "17:30",
    workingDays: MON_FRI,
    officeDays: [3, 4],
    site: "London office",
  },
];

/** The example's people alone (no clock needed): the Standup's example reads their places. */
export function examplePeople(at = "2026-01-01T00:00:00.000Z"): TeamTimePerson[] {
  return PLACES.map((p) => ({
    id: exampleId(`ttp-${p.key}`),
    teamMemberId: exampleId(`member-${p.key}`),
    name: p.name,
    // Stored canonical, as every row is: runtimes spell some zones differently.
    timeZone: canonicalZone(p.timeZone) ?? p.timeZone,
    start: p.start,
    end: p.end,
    workingDays: [...p.workingDays],
    ...(p.officeDays ? { officeDays: [...p.officeDays] } : {}),
    ...(p.site ? { site: p.site } : {}),
    createdAt: at,
    updatedAt: at,
  }));
}

/** The Monday on or before a UTC day number. */
function mondayOf(dayNumber: number): number {
  const weekday = weekdayOf(isoFromDayNumber(dayNumber)) ?? 1;
  return dayNumber - ((weekday + 6) % 7);
}

/** The example as of `now`: the poll's slots next week, the rotation's start four weeks back. */
export function buildTeamTimeExample(now: Date): TeamTimeExample {
  const at = now.toISOString();
  const today = isoDayNumber(at) ?? 0;
  const nextMonday = mondayOf(today) + 7;
  const slot = (key: string, offsetDays: number, time: string) => ({
    id: exampleId(`slot-${key}`),
    start: `${isoFromDayNumber(nextMonday + offsetDays)}T${time}:00.000Z`,
  });
  const slots = [slot("tue", 1, "13:00"), slot("wed", 2, "13:30"), slot("thu", 3, "14:00")];
  const [tue, wed, thu] = slots.map((s) => s.id);
  const people = examplePeople(at);
  const startMonday = mondayOf(today) - 28;
  const tuesday = (cycle: number) => isoFromDayNumber(startMonday + 14 * cycle + 1);
  return {
    roster: PLACES.map((p) => ({ id: exampleId(`member-${p.key}`), name: p.name, role: p.role })),
    people,
    polls: [
      {
        id: exampleId("poll-review"),
        title: "Sprint Review time",
        minutes: 60,
        slots,
        answers: [
          { name: "Priya (PM)", picks: { [tue]: "yes", [wed]: "yes", [thu]: "yes" } },
          { name: "Ana (Backend)", picks: { [tue]: "yes", [wed]: "yes", [thu]: "maybe" } },
          { name: "Sam (QA)", picks: { [tue]: "yes", [wed]: "maybe", [thu]: "yes" } },
          { name: "Lee (iOS)", picks: { [tue]: "no", [wed]: "no", [thu]: "no" } },
        ],
        status: "open",
        createdAt: at,
        updatedAt: at,
      },
    ],
    rotations: [
      {
        id: exampleId("rotation-retro"),
        meeting: "Retro",
        minutes: 60,
        everyWeeks: 2,
        startDate: isoFromDayNumber(startMonday),
        mode: "in-turn",
        options: [
          {
            id: exampleId("option-europe"),
            label: "Europe morning",
            weekday: 2,
            time: "09:00",
            timeZone: canonicalZone("Europe/London") ?? "Europe/London",
          },
          {
            id: exampleId("option-americas"),
            label: "Americas afternoon",
            weekday: 2,
            time: "15:00",
            timeZone: canonicalZone("America/Toronto") ?? "America/Toronto",
          },
        ],
        held: [
          { date: tuesday(0), optionId: exampleId("option-europe") },
          { date: tuesday(1), optionId: exampleId("option-americas") },
        ],
        createdAt: at,
        updatedAt: at,
      },
    ],
  };
}
