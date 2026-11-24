/**
 * Shared hours: each person's shifts as instants (a night shift belongs to
 * the day it starts), the everyone and all-but-one windows with who is left
 * out, the week on a clock, the lines the page lists, the best window, the
 * core-hours band and the clock changes ahead with the shared time either
 * side.
 */

import { describe, expect, it } from "vitest";
import {
  bestDayMinutes,
  bestSharedWindow,
  clockChanges,
  coreHoursIntervals,
  sharedWindows,
  weekRange,
  windowLines,
  workIntervals,
} from "@/lib/team-time/overlap";
import { london, newYork, person, t, tokyo } from "./fixtures";

const iso = (n: number) => new Date(n).toISOString();
const span = (w: { start: number; end: number }) => `${iso(w.start)}–${iso(w.end)}`;

const WEEK = { from: t("2026-11-16T00:00:00Z"), to: t("2026-11-23T00:00:00Z") };

describe("workIntervals", () => {
  it("gives each working day's shift as instants, cut to the range", () => {
    const shifts = workIntervals(newYork, WEEK.from, WEEK.to);
    expect(shifts).toHaveLength(5);
    expect(span(shifts[0])).toBe("2026-11-16T14:00:00.000Z–2026-11-16T22:00:00.000Z");
    expect(workIntervals(newYork, t("2026-11-16T15:00:00Z"), t("2026-11-16T16:00:00Z"))).toEqual([
      { start: t("2026-11-16T15:00:00Z"), end: t("2026-11-16T16:00:00Z") },
    ]);
  });

  it("runs a night shift past midnight, on the day it starts", () => {
    const night = person({ id: "n", timeZone: "Europe/London", start: "22:00", end: "06:00" });
    const shifts = workIntervals(night, WEEK.from, WEEK.to);
    expect(span(shifts[0])).toBe("2026-11-16T22:00:00.000Z–2026-11-17T06:00:00.000Z");
    // Friday's shift runs into Saturday; Saturday's day off has none.
    expect(span(shifts[shifts.length - 1])).toBe(
      "2026-11-20T22:00:00.000Z–2026-11-21T06:00:00.000Z"
    );
    expect(shifts).toHaveLength(5);
  });

  it("follows the clock change on the real date", () => {
    const shifts = workIntervals(london, t("2026-03-27T00:00:00Z"), t("2026-03-31T00:00:00Z"));
    expect(shifts.map(span)).toEqual([
      "2026-03-27T09:00:00.000Z–2026-03-27T17:30:00.000Z",
      "2026-03-30T08:00:00.000Z–2026-03-30T16:30:00.000Z",
    ]);
  });
});

describe("sharedWindows", () => {
  it("finds when everyone is working", () => {
    const { everyone, allButOne } = sharedWindows([london, newYork], WEEK.from, WEEK.to);
    expect(everyone).toHaveLength(5);
    expect(span(everyone[0])).toBe("2026-11-16T14:00:00.000Z–2026-11-16T17:30:00.000Z");
    expect(everyone[0].leftOut).toBeNull();
    // Two people have no "all but one".
    expect(allButOne).toEqual([]);
  });

  it("finds when all but one are working, and who is left out", () => {
    const { everyone, allButOne } = sharedWindows([london, newYork, tokyo], WEEK.from, WEEK.to);
    expect(everyone).toEqual([]);
    const monday = allButOne.filter((w) => iso(w.start).startsWith("2026-11-16"));
    expect(monday.map((w) => [span(w), w.leftOut])).toEqual([
      ["2026-11-16T14:00:00.000Z–2026-11-16T17:30:00.000Z", "tokyo"],
    ]);
  });

  it("puts a Sunday-to-Thursday week next to a Monday-to-Friday one", () => {
    const dubai = person({ id: "dubai", timeZone: "Asia/Dubai", workingDays: [0, 1, 2, 3, 4] });
    const { everyone } = sharedWindows([london, dubai], WEEK.from, WEEK.to);
    const lines = windowLines(everyone, "UTC");
    expect(lines).toEqual([
      { start: "09:00", end: "13:00", days: [1, 2, 3, 4], minutes: 240, leftOut: null },
    ]);
  });

  it("is empty with nobody, and one person's own hours alone", () => {
    expect(sharedWindows([], WEEK.from, WEEK.to)).toEqual({ everyone: [], allButOne: [] });
    expect(sharedWindows([london], WEEK.from, WEEK.to).everyone).toHaveLength(5);
  });

  it("doesn't count a hand-over at the same minute as time shared", () => {
    const early = person({ id: "e", start: "06:00", end: "09:00" });
    const late = person({ id: "l", start: "09:00", end: "12:00" });
    expect(sharedWindows([early, late], WEEK.from, WEEK.to).everyone).toEqual([]);
  });
});

describe("weeks and lines", () => {
  it("starts the week on Monday at midnight on the clock asked for", () => {
    const utcWeek = weekRange("UTC", t("2026-11-18T10:00:00Z"));
    expect([iso(utcWeek.from), iso(utcWeek.to)]).toEqual([
      "2026-11-16T00:00:00.000Z",
      "2026-11-23T00:00:00.000Z",
    ]);
    expect(utcWeek.days[0]).toBe("2026-11-16");
    expect(utcWeek.days).toHaveLength(7);
    const tokyoWeek = weekRange("Asia/Tokyo", t("2026-11-15T20:00:00Z"));
    expect(iso(tokyoWeek.from)).toBe("2026-11-15T15:00:00.000Z");
    expect(iso(weekRange("UTC", t("2026-11-18T10:00:00Z"), 1).from)).toBe(
      "2026-11-23T00:00:00.000Z"
    );
  });

  it("lists a window at the same time on several days once, on the display clock", () => {
    const { everyone } = sharedWindows([london, newYork], WEEK.from, WEEK.to);
    expect(windowLines(everyone, "UTC")).toEqual([
      { start: "14:00", end: "17:30", days: [1, 2, 3, 4, 5], minutes: 210, leftOut: null },
    ]);
    expect(windowLines(everyone, "America/New_York")[0]).toMatchObject({
      start: "09:00",
      end: "12:30",
    });
    expect(bestDayMinutes(everyone, "UTC")).toBe(210);
    expect(bestDayMinutes([], "UTC")).toBe(0);
  });

  it("picks the week's best window, or the all-but-one one when nothing covers everyone", () => {
    const now = t("2026-11-18T10:00:00Z");
    expect(bestSharedWindow([london, newYork], "UTC", now)).toEqual({
      kind: "everyone",
      start: "14:00",
      end: "17:30",
      days: [1, 2, 3, 4, 5],
      minutes: 210,
      leftOut: null,
    });
    expect(bestSharedWindow([london, newYork, tokyo], "UTC", now)).toMatchObject({
      kind: "all-but-one",
      leftOut: "tokyo",
    });
    expect(bestSharedWindow([london, tokyo], "UTC", now)).toBeNull();
  });

  it("draws the charter's core hours as instants on their days", () => {
    const band = coreHoursIntervals(
      { start: "13:00", end: "15:00", timeZone: "Europe/London", days: [1, 2, 3, 4] },
      WEEK.from,
      WEEK.to
    );
    expect(band.map(span)[0]).toBe("2026-11-16T13:00:00.000Z–2026-11-16T15:00:00.000Z");
    expect(band).toHaveLength(4);
    expect(
      coreHoursIntervals(
        { start: "13:00", end: "15:00", timeZone: "", days: [1] },
        WEEK.from,
        WEEK.to
      )
    ).toEqual([]);
  });
});

describe("clockChanges", () => {
  it("lists the changes ahead with the shared time before and after each", () => {
    const changes = clockChanges([london, newYork], t("2026-03-01T00:00:00Z"), 8, "UTC");
    expect(
      changes.map((c) => ({
        at: iso(c.at),
        zones: c.zones.map((z) => [z.zone, z.fromOffset, z.toOffset]),
        people: c.people,
        before: c.before,
        after: c.after,
      }))
    ).toEqual([
      {
        at: "2026-03-08T07:00:00.000Z",
        zones: [["America/New_York", -300, -240]],
        people: ["ny"],
        before: 210,
        after: 270,
      },
      {
        at: "2026-03-29T01:00:00.000Z",
        zones: [["Europe/London", 0, 60]],
        people: ["london"],
        before: 270,
        after: 210,
      },
    ]);
  });

  it("has none in a zone without clock changes", () => {
    expect(clockChanges([tokyo], t("2026-03-01T00:00:00Z"))).toEqual([]);
  });
});
