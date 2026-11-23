/**
 * Team Time's example, its words for times, and the schedule note's input
 * and rules: the example's checkout team shares an all-but-one window
 * (everyone but Lee) and a London anchor day (Thursday); the note merges
 * places, never carries a name, and its own tips follow the shared time.
 */

import { describe, expect, it } from "vitest";
import { buildTeamTimeExample } from "@/lib/team-time/example";
import { daysLabel, minutesText, namesList, slotLabel } from "@/lib/team-time/format";
import { officeGroups } from "@/lib/team-time/office";
import { sharedWindows, weekRange, windowLines } from "@/lib/team-time/overlap";
import { readPerson, readPoll, readRotation } from "@/lib/team-time/rows";
import { scheduleNoteInput, scheduleTips } from "@/lib/team-time/note";
import { isExampleId } from "@/lib/utils/example-id";
import { london, newYork, person, t } from "./fixtures";

const NOW = new Date("2026-11-18T10:00:00Z");

describe("the example", () => {
  const ex = buildTeamTimeExample(NOW);

  it("is all example rows that read back as they are", () => {
    for (const p of ex.people) expect(readPerson(p)).toEqual(p);
    for (const p of ex.polls) expect(readPoll(p)).toEqual(p);
    for (const r of ex.rotations) expect(readRotation(r)).toEqual(r);
    const ids = [...ex.people, ...ex.polls, ...ex.rotations, ...ex.roster].map((x) => x.id);
    expect(ids.every(isExampleId)).toBe(true);
    expect(ex.people.map((p) => p.name)).toContain("Priya (PM)");
  });

  it("has everyone but Lee sharing 13:00–14:00 UTC, Monday to Thursday", () => {
    const week = weekRange("UTC", NOW);
    const shared = sharedWindows(ex.people, week.from, week.to);
    expect(shared.everyone).toEqual([]);
    const lee = ex.people.find((p) => p.name === "Lee (iOS)")!.id;
    expect(windowLines(shared.allButOne, "UTC")).toContainEqual({
      start: "13:00",
      end: "14:00",
      days: [1, 2, 3, 4],
      minutes: 60,
      leftOut: lee,
    });
  });

  it("gives the London office Thursday as its anchor day", () => {
    const groups = officeGroups(ex.people);
    expect(groups.map((g) => [g.label, g.anchorDays])).toEqual([["London office", [4]]]);
  });

  it("puts the poll's times ahead of now", () => {
    expect(ex.polls[0].slots.every((s) => t(s.start) > NOW.getTime())).toBe(true);
  });
});

describe("words", () => {
  it("says days, lengths and names plainly", () => {
    expect(daysLabel([1, 2, 3, 4])).toBe("Mon–Thu");
    expect(daysLabel([0, 1, 2, 3, 4])).toBe("Sun–Thu");
    expect(daysLabel([1, 3])).toBe("Mon, Wed");
    expect(daysLabel([6, 0])).toBe("Sat, Sun");
    expect(daysLabel([0, 1, 2, 3, 4, 5, 6])).toBe("every day");
    expect(minutesText(45)).toBe("45 min");
    expect(minutesText(90)).toBe("1 h 30");
    expect(namesList(["Lee", "Dev", "Sam"])).toBe("Lee, Dev and Sam");
    expect(slotLabel("2026-11-18T14:00:00Z")).toBe("Wed 18 Nov 14:00 UTC");
  });
});

describe("the schedule note", () => {
  it("merges places by offset and office, east to west, with no names", () => {
    const people = [
      london,
      person({
        id: "l2",
        name: "Secret Name",
        timeZone: "Europe/London",
        start: "09:00",
        end: "17:30",
      }),
      newYork,
    ];
    const input = scheduleNoteInput({
      people,
      now: NOW,
      zone: "UTC",
      cadence: null,
      rotations: [],
    });
    expect(input.places).toEqual([
      { label: "London", offsetMinutes: 0, people: 2, hours: "09:00–17:30", days: "Mon–Fri" },
      { label: "New York", offsetMinutes: -300, people: 1, hours: "09:00–17:00", days: "Mon–Fri" },
    ]);
    expect(input.overlapMinutes).toBe(210);
    expect(JSON.stringify(input)).not.toContain("Secret Name");
  });

  it("keeps the 12 places with the most people", () => {
    const zones = [
      "Pacific/Honolulu",
      "America/Anchorage",
      "America/Los_Angeles",
      "America/Denver",
      "America/Chicago",
      "America/New_York",
      "America/Sao_Paulo",
      "Atlantic/Azores",
      "Europe/London",
      "Europe/Berlin",
      "Asia/Dubai",
      "Asia/Kolkata",
      "Asia/Tokyo",
    ];
    const people = zones.map((z, i) => person({ id: `p${i}`, timeZone: z }));
    people.push(person({ id: "extra", timeZone: "Asia/Tokyo" }));
    const input = scheduleNoteInput({
      people,
      now: NOW,
      zone: "UTC",
      cadence: null,
      rotations: [],
    });
    expect(input.places).toHaveLength(12);
    expect(input.places[0]).toMatchObject({ label: "Tokyo", people: 2 });
  });

  it("writes its own tips from the shared time", () => {
    const base = scheduleNoteInput({
      people: [london, newYork],
      now: NOW,
      zone: "UTC",
      cadence: null,
      rotations: [],
    });
    expect(scheduleTips(base).tips[0]).toMatch(/^Keep the team's meetings inside the shared hours/);
    expect(scheduleTips({ ...base, overlapMinutes: 90 }).tips[0]).toMatch(/^Fit the Daily Scrum/);
    expect(scheduleTips({ ...base, overlapMinutes: 30 }).tips[0]).toMatch(
      /^Use the written standup/
    );
    const note = scheduleTips({
      ...base,
      meetings: [{ name: "Retro", outsideHours: 2, nightOrDayOff: 1 }],
      anchorDays: [{ site: "London office", days: [4] }],
      clockChanges: ["Sun 29 Mar: London moves to UTC+1"],
    });
    expect(note.tips).toEqual([
      "Keep the team's meetings inside the shared hours, and protect the rest for focus.",
      "Rotate Retro: it lands at night or on a day off for 1 person.",
      "Check the shared hours again after the clock change. Sun 29 Mar: London moves to UTC+1",
      "Plan in-person work at London office on Thu, the day most people are in.",
    ]);
    expect(note.note).toBe(
      "The team works in 2 places, from London to New York, 5 hours apart. Everyone shares 3 h 30 on the best day."
    );
  });

  it("has nothing to say without places", () => {
    expect(() =>
      scheduleTips({
        places: [],
        overlapMinutes: 0,
        mostOverlapMinutes: 0,
        meetings: [],
        anchorDays: [],
        clockChanges: [],
      })
    ).toThrow();
  });
});
