/**
 * Team Time's zones and rows: which zones Intl knows, the readers that turn
 * a stored row into a usable one or null, the rules a write is refused for,
 * and who counts as the same person. Zones are only the long-stable ones
 * (UTC, Europe/London, Asia/Tokyo, America/New_York).
 */

import { describe, expect, it } from "vitest";
import { canonicalZone, isTimeZone } from "@/lib/team-time/zones";
import {
  isCalendarDay,
  personProblems,
  pollProblems,
  readPerson,
  readPoll,
  readRotation,
  rotationProblems,
  samePerson,
} from "@/lib/team-time/rows";
import { TEAM_TIME_MAX, TOOL_TEXT_MAX } from "@/lib/stores/workspace-types";
import { TEAM_TIME_PERSON, TEAM_TIME_POLL, TEAM_TIME_ROTATION } from "../stores/phase43-fixtures";

describe("zones", () => {
  it("knows the zones Intl knows", () => {
    for (const zone of ["UTC", "Europe/London", "Asia/Tokyo", "America/New_York"]) {
      expect(isTimeZone(zone), zone).toBe(true);
    }
    for (const zone of ["", " ", "Mars/Olympus", "GMT+25", 3, null, undefined]) {
      expect(isTimeZone(zone), String(zone)).toBe(false);
    }
  });

  it("spells a zone the canonical way, and gives null for one it doesn't know", () => {
    expect(canonicalZone("europe/london")).toBe("Europe/London");
    expect(canonicalZone("Asia/Tokyo")).toBe("Asia/Tokyo");
    expect(canonicalZone("Mars/Olympus")).toBeNull();
  });
});

describe("readPerson", () => {
  it("reads a stored person as it is", () => {
    expect(readPerson(TEAM_TIME_PERSON)).toEqual(TEAM_TIME_PERSON);
  });

  it("is null without an id, a known zone, good times, distinct hours or working days", () => {
    expect(readPerson(null)).toBeNull();
    expect(readPerson({ ...TEAM_TIME_PERSON, id: "" })).toBeNull();
    expect(readPerson({ ...TEAM_TIME_PERSON, timeZone: "Mars/Olympus" })).toBeNull();
    expect(readPerson({ ...TEAM_TIME_PERSON, start: "9am" })).toBeNull();
    expect(readPerson({ ...TEAM_TIME_PERSON, end: "25:00" })).toBeNull();
    expect(readPerson({ ...TEAM_TIME_PERSON, start: "09:00", end: "09:00" })).toBeNull();
    expect(readPerson({ ...TEAM_TIME_PERSON, workingDays: [] })).toBeNull();
    expect(readPerson({ ...TEAM_TIME_PERSON, workingDays: [9, "x"] })).toBeNull();
  });

  it("drops office days that aren't working days, spells the zone and applies the caps", () => {
    const read = readPerson({
      ...TEAM_TIME_PERSON,
      timeZone: "europe/london",
      workingDays: [5, 1, 1, 3],
      officeDays: [3, 6],
      name: "x".repeat(TOOL_TEXT_MAX.short + 5),
      site: "y".repeat(TEAM_TIME_MAX.site + 5),
    });
    expect(read?.timeZone).toBe("Europe/London");
    expect(read?.workingDays).toEqual([1, 3, 5]);
    expect(read?.officeDays).toEqual([3]);
    expect(read?.name).toHaveLength(TOOL_TEXT_MAX.short);
    expect(read?.site).toHaveLength(TEAM_TIME_MAX.site);
    expect(readPerson({ ...TEAM_TIME_PERSON, officeDays: [0] })).not.toHaveProperty("officeDays");
  });
});

describe("readPoll", () => {
  it("reads a stored poll as it is", () => {
    expect(readPoll(TEAM_TIME_POLL)).toEqual(TEAM_TIME_POLL);
  });

  it("is null without an id or a length", () => {
    expect(readPoll({ ...TEAM_TIME_POLL, id: undefined })).toBeNull();
    expect(readPoll({ ...TEAM_TIME_POLL, minutes: 0 })).toBeNull();
  });

  it("drops bad slots, picks of slots it doesn't have and a choice it doesn't have", () => {
    const read = readPoll({
      ...TEAM_TIME_POLL,
      slots: [...TEAM_TIME_POLL.slots, { id: "bad", start: "teatime" }],
      answers: [{ name: "Ana", picks: { s1: "yes", bad: "yes", s2: "perhaps" } }],
      chosenSlotId: "bad",
      status: "nope",
    });
    expect(read?.slots.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(read?.answers).toEqual([{ name: "Ana", picks: { s1: "yes" } }]);
    expect(read).not.toHaveProperty("chosenSlotId");
    expect(read?.status).toBe("open");
  });

  it("caps slots and answers", () => {
    const read = readPoll({
      ...TEAM_TIME_POLL,
      slots: Array.from({ length: TEAM_TIME_MAX.slots + 3 }, (_, i) => ({
        id: `s${i}`,
        start: new Date(Date.UTC(2026, 10, 1, i)).toISOString(),
      })),
      answers: Array.from({ length: TEAM_TIME_MAX.answers + 3 }, (_, i) => ({
        name: `p${i}`,
        picks: {},
      })),
    });
    expect(read?.slots).toHaveLength(TEAM_TIME_MAX.slots);
    expect(read?.answers).toHaveLength(TEAM_TIME_MAX.answers);
  });
});

describe("readRotation", () => {
  it("reads a stored rotation as it is", () => {
    expect(readRotation(TEAM_TIME_ROTATION)).toEqual(TEAM_TIME_ROTATION);
  });

  it("is null without an id, a length, a real start date or two usable options", () => {
    expect(readRotation({ ...TEAM_TIME_ROTATION, id: 7 })).toBeNull();
    expect(readRotation({ ...TEAM_TIME_ROTATION, minutes: -5 })).toBeNull();
    expect(readRotation({ ...TEAM_TIME_ROTATION, startDate: "2026-02-30" })).toBeNull();
    const [first, second] = TEAM_TIME_ROTATION.options;
    expect(
      readRotation({ ...TEAM_TIME_ROTATION, options: [first, { ...second, timeZone: "Nowhere" }] })
    ).toBeNull();
    expect(
      readRotation({ ...TEAM_TIME_ROTATION, options: [first, { ...second, time: "late" }] })
    ).toBeNull();
  });

  it("caps options, and drops held meetings of an option that's gone", () => {
    const options = Array.from({ length: 6 }, (_, i) => ({
      id: `o${i}`,
      weekday: i % 7,
      time: "10:00",
      timeZone: "UTC",
    }));
    const read = readRotation({
      ...TEAM_TIME_ROTATION,
      options,
      held: [
        { date: "2026-11-05", optionId: "o1" },
        { date: "2026-11-19", optionId: "o5" },
      ],
    });
    expect(read?.options).toHaveLength(TEAM_TIME_MAX.options);
    expect(read?.held).toEqual([{ date: "2026-11-05", optionId: "o1" }]);
  });
});

describe("the rules a write is refused for", () => {
  it("a person's hours can't start and end together, and office days are working days", () => {
    expect(personProblems(TEAM_TIME_PERSON)).toEqual([]);
    expect(personProblems({ ...TEAM_TIME_PERSON, start: "10:00", end: "10:00" })[0]).toMatch(
      /start and end at the same time \(10:00\)/
    );
    expect(personProblems({ ...TEAM_TIME_PERSON, workingDays: [1], officeDays: [1, 2] })).toEqual([
      "Office days 2 aren't working days. Pick office days among the working days.",
    ]);
  });

  it("a poll's slots don't repeat, and its choice and picks are its own slots", () => {
    expect(pollProblems(TEAM_TIME_POLL)).toEqual([]);
    const [s1] = TEAM_TIME_POLL.slots;
    expect(pollProblems({ ...TEAM_TIME_POLL, slots: [s1, { ...s1 }] }).join(" ")).toMatch(
      /Slot ids repeat \(s1\)/
    );
    expect(
      pollProblems({
        ...TEAM_TIME_POLL,
        chosenSlotId: undefined,
        answers: [],
        slots: [s1, { id: "s9", start: s1.start }],
      })
    ).toEqual([`Slots repeat a time (${s1.start}). Offer each time once.`]);
    expect(pollProblems({ ...TEAM_TIME_POLL, chosenSlotId: "s9" })).toEqual([
      "The chosen slot s9 isn't one of the poll's slots.",
    ]);
  });

  it("a rotation has 2 to 4 options and a real start date, and is never judged on the future", () => {
    expect(rotationProblems(TEAM_TIME_ROTATION)).toEqual([]);
    expect(rotationProblems({ ...TEAM_TIME_ROTATION, startDate: "2099-01-01" })).toEqual([]);
    expect(
      rotationProblems({ ...TEAM_TIME_ROTATION, options: TEAM_TIME_ROTATION.options.slice(0, 1) })
    ).toEqual(["A rotation moves between 2 and 4 times; this one has 1."]);
    expect(rotationProblems({ ...TEAM_TIME_ROTATION, startDate: "2026-13-01" })).toEqual([
      "The start date 2026-13-01 isn't a day on the calendar (YYYY-MM-DD).",
    ]);
  });

  it("isCalendarDay takes only real YYYY-MM-DD days", () => {
    expect(isCalendarDay("2028-02-29")).toBe(true);
    expect(isCalendarDay("2026-02-29")).toBe(false);
    expect(isCalendarDay("2026-11-12T09:00:00Z")).toBe(false);
  });
});

describe("samePerson", () => {
  it("matches by roster member when both name one, otherwise by name", () => {
    expect(
      samePerson({ name: "Ana", teamMemberId: "m1" }, { name: "Anna", teamMemberId: "m1" })
    ).toBe(true);
    expect(
      samePerson({ name: "Ana", teamMemberId: "m1" }, { name: "Ana", teamMemberId: "m2" })
    ).toBe(false);
    expect(samePerson({ name: " ana " }, { name: "Ana", teamMemberId: "m1" })).toBe(true);
    expect(samePerson({ name: "Ana" }, { name: "Bo" })).toBe(false);
    expect(samePerson({ name: " " }, { name: "" })).toBe(false);
  });
});
