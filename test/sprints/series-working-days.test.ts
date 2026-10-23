/**
 * The ideal line on working days: flat over weekends and holidays, still
 * from the plan on day 0 to 0 on the last day; the calendar-day convention
 * whenever a calendar can't apply (none given, placeholder or missing dates,
 * no working day in the sprint). Stored day numbers stay calendar days.
 */

import { describe, expect, it } from "vitest";
import type { Sprint } from "@/lib/stores/workspace-types";
import { DEFAULT_CALENDAR, normalizeCalendar } from "@/lib/sprints/calendar";
import {
  dayForDate,
  dayForWorkingDay,
  elapsedWorkingDays,
  idealLine,
  idealRemainingAt,
  sprintWorkingDays,
  workingDayAxis,
  workingDayForDate,
} from "@/lib/sprints/series";

// Monday 5 Oct to Friday 16 Oct 2026: 11 calendar days, 9 working days
// before the last morning (the last day's own work counts after it ends).
const SPRINT: Sprint = {
  id: "s1",
  name: "Sprint 1",
  startDate: "2026-10-05",
  endDate: "2026-10-16",
  pointsPlanned: 45,
  status: "active",
};
const CAL = DEFAULT_CALENDAR;

describe("workingDayAxis", () => {
  it("counts the working days done by each morning, flat over the weekend", () => {
    expect(workingDayAxis(SPRINT, CAL)).toEqual([0, 1, 2, 3, 4, 5, 5, 5, 6, 7, 8, 9]);
    expect(sprintWorkingDays(SPRINT, CAL)).toBe(9);
  });

  it("leaves holidays out", () => {
    const cal = normalizeCalendar({ holidays: ["2026-10-07"] }); // the first Wednesday
    expect(workingDayAxis(SPRINT, cal)).toEqual([0, 1, 2, 2, 3, 4, 4, 4, 5, 6, 7, 8]);
    expect(sprintWorkingDays(SPRINT, cal)).toBe(8);
  });

  it("is the calendar days without a calendar", () => {
    expect(workingDayAxis(SPRINT)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(sprintWorkingDays(SPRINT)).toBe(11);
  });

  it("falls back to calendar days for placeholder or missing dates", () => {
    const synthetic = { ...SPRINT, startDate: "2020-01-01", endDate: "2020-01-08" };
    expect(workingDayAxis(synthetic, CAL)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    const undated = { ...SPRINT, startDate: "", endDate: "" };
    expect(sprintWorkingDays(undated, CAL)).toBe(10); // DEFAULT_SPRINT_DAYS
  });

  it("falls back to calendar days when the sprint holds no working day", () => {
    const weekend = { ...SPRINT, startDate: "2026-10-10", endDate: "2026-10-12" }; // Sat → Mon
    expect(workingDayAxis(weekend, CAL)).toEqual([0, 1, 2]);
    expect(idealRemainingAt(weekend, 10, 1, CAL)).toBe(5);
  });

  it("counts past the end for late readings", () => {
    expect(elapsedWorkingDays(SPRINT, 14, CAL)).toBe(10); // the Monday after
    expect(elapsedWorkingDays(SPRINT, -2, CAL)).toBe(0);
  });
});

describe("idealRemainingAt / idealLine", () => {
  it("burns only on working days and reaches 0 on the last day", () => {
    expect(idealRemainingAt(SPRINT, 45, 0, CAL)).toBe(45);
    expect(idealRemainingAt(SPRINT, 45, 5, CAL)).toBe(20); // Saturday: Mon–Fri done
    expect(idealRemainingAt(SPRINT, 45, 7, CAL)).toBe(20); // Monday morning: no change
    expect(idealRemainingAt(SPRINT, 45, 8, CAL)).toBeCloseTo(15, 10);
    expect(idealRemainingAt(SPRINT, 45, 11, CAL)).toBe(0);
  });

  it("reads before the start as the plan and after the end as 0", () => {
    expect(idealRemainingAt(SPRINT, 45, -4, CAL)).toBe(45);
    expect(idealRemainingAt(SPRINT, 45, 40, CAL)).toBe(0);
  });

  it("keeps the calendar-day line without a calendar (the tools' convention)", () => {
    expect(idealRemainingAt(SPRINT, 44, 5)).toBe(24);
    expect(idealRemainingAt(SPRINT, 44, 11)).toBe(0);
  });

  it("gives the same numbers as a whole line, for 0 and huge commitments too", () => {
    const line = idealLine(SPRINT, 45, CAL);
    expect(line).toHaveLength(12);
    line.forEach((v, d) => expect(v).toBeCloseTo(idealRemainingAt(SPRINT, 45, d, CAL), 10));
    expect(idealLine(SPRINT, 0, CAL).every((v) => v === 0)).toBe(true);
    expect(idealRemainingAt(SPRINT, 1e12, 5, CAL)).toBeCloseTo((1e12 * 4) / 9, 0);
  });
});

describe("workingDayForDate / dayForWorkingDay", () => {
  it("counts working days done by a date's morning, negative before the start", () => {
    expect(workingDayForDate(SPRINT, "2026-10-05", CAL)).toBe(0);
    expect(workingDayForDate(SPRINT, "2026-10-06", CAL)).toBe(1);
    expect(workingDayForDate(SPRINT, "2026-10-10", CAL)).toBe(5);
    expect(workingDayForDate(SPRINT, "2026-10-12", CAL)).toBe(5);
    expect(workingDayForDate(SPRINT, "2026-10-02", CAL)).toBe(-1);
    expect(workingDayForDate(SPRINT, "junk", CAL)).toBeNull();
    expect(workingDayForDate({ startDate: "" }, "2026-10-06", CAL)).toBeNull();
  });

  it("leaves dayForDate on calendar days (the index the daily log is stored under)", () => {
    expect(dayForDate(SPRINT, "2026-10-12")).toBe(7);
  });

  it("maps working days back to the earliest calendar day with them done", () => {
    expect(dayForWorkingDay(SPRINT, 5, CAL)).toBe(5);
    expect(dayForWorkingDay(SPRINT, 6, CAL)).toBe(8);
    expect(dayForWorkingDay(SPRINT, 9, CAL)).toBe(11);
    expect(dayForWorkingDay(SPRINT, 11, CAL)).toBe(15); // past the end
    expect(dayForWorkingDay(SPRINT, 6.5)).toBe(6.5); // no calendar: unchanged
  });
});
