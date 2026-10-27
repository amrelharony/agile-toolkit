/**
 * Working hours: wall-clock times read as written (never through the host's
 * time zone), the minutes on working days summed, a weekend and a holiday
 * left out, a working window clipping each day, and the bad inputs refused.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_CALENDAR,
  isWorkingDay,
  isoDayNumber,
  isoFromDayNumber,
  parseClockTime,
  parseWallClock,
  workingHoursBetween,
  type WorkingCalendar,
  type WorkingWindowMinutes,
} from "@/lib/sprints/calendar";

// Friday 16 and Monday 19 October 2026.
const FRI = "2026-10-16";
const MON = "2026-10-19";
const NINE_TO_FIVE: WorkingWindowMinutes = { startMinute: 9 * 60, endMinute: 17 * 60 };

describe("parseWallClock", () => {
  it("reads the day and the minute as written", () => {
    expect(parseWallClock("2026-10-16T17:05")).toEqual({ day: FRI, minute: 17 * 60 + 5 });
    expect(parseWallClock("2026-10-16 09:30")).toEqual({ day: FRI, minute: 570 });
    expect(parseWallClock("2026-10-16T09:30:59.123")).toEqual({ day: FRI, minute: 570 });
    expect(parseWallClock(FRI)).toEqual({ day: FRI, minute: 0 });
  });

  it("ignores a zone suffix: the written time is the one counted", () => {
    expect(parseWallClock("2026-10-16T23:30:00Z")).toEqual({ day: FRI, minute: 23 * 60 + 30 });
    expect(parseWallClock("2026-10-16T23:30:00.000+05:30")).toEqual({ day: FRI, minute: 1410 });
    expect(parseWallClock("2026-10-16T08:00-0700")).toEqual({ day: FRI, minute: 480 });
  });

  it("refuses what isn't a wall-clock time", () => {
    for (const bad of [
      "",
      "   ",
      "16/10/2026 09:00",
      "2026-02-30T09:00",
      "2026-10-16T24:00",
      "2026-10-16T09:60",
      "2026-10-16T9:00",
      "soon",
    ]) {
      expect(parseWallClock(bad), bad).toBeNull();
    }
    expect(parseWallClock(null)).toBeNull();
    expect(parseWallClock(undefined)).toBeNull();
  });

  it("parseClockTime reads a 24-hour HH:MM", () => {
    expect(parseClockTime("09:00")).toBe(540);
    expect(parseClockTime("23:59")).toBe(1439);
    expect(parseClockTime("00:00")).toBe(0);
    for (const bad of ["9:00", "24:00", "12:60", "noon", ""])
      expect(parseClockTime(bad), bad).toBeNull();
  });
});

describe("workingHoursBetween", () => {
  it("leaves the weekend out: Friday 17:00 to Monday 10:00", () => {
    expect(workingHoursBetween(`${FRI}T17:00`, `${MON}T10:00`)).toBe(17);
    expect(
      workingHoursBetween(`${FRI}T17:00`, `${MON}T10:00`, DEFAULT_CALENDAR, NINE_TO_FIVE)
    ).toBe(1);
  });

  it("counts whole working days between bare dates", () => {
    expect(workingHoursBetween(MON, "2026-10-20")).toBe(24);
    expect(workingHoursBetween(MON, "2026-10-26", DEFAULT_CALENDAR, NINE_TO_FIVE)).toBe(40);
    // Saturday to Sunday: nothing to count.
    expect(workingHoursBetween("2026-10-17T10:00", "2026-10-18T15:00")).toBe(0);
  });

  it("leaves a holiday out", () => {
    const calendar: WorkingCalendar = { workingDays: [1, 2, 3, 4, 5], holidays: [MON] };
    expect(workingHoursBetween(`${FRI}T17:00`, "2026-10-20T10:00", calendar, NINE_TO_FIVE)).toBe(1);
    expect(workingHoursBetween(`${MON}T09:00`, `${MON}T17:00`, calendar)).toBe(0);
    expect(workingHoursBetween(`${FRI}T16:00`, "2026-10-20T10:00", calendar)).toBe(18);
  });

  it("follows the team's own weekdays", () => {
    const sundayToThursday: WorkingCalendar = { workingDays: [0, 1, 2, 3, 4], holidays: [] };
    // Friday is off, Sunday is on.
    expect(workingHoursBetween(`${FRI}T09:00`, "2026-10-18T12:00", sundayToThursday)).toBe(12);
  });

  it("clips to the window on a single day", () => {
    expect(
      workingHoursBetween(`${MON}T08:00`, `${MON}T18:00`, DEFAULT_CALENDAR, NINE_TO_FIVE)
    ).toBe(8);
    expect(
      workingHoursBetween(`${MON}T10:15`, `${MON}T11:45`, DEFAULT_CALENDAR, NINE_TO_FIVE)
    ).toBe(1.5);
    expect(
      workingHoursBetween(`${MON}T18:00`, `${MON}T20:00`, DEFAULT_CALENDAR, NINE_TO_FIVE)
    ).toBe(0);
    expect(workingHoursBetween(`${MON}T10:00`, `${MON}T10:20`)).toBeCloseTo(1 / 3, 10);
  });

  it("is 0 for the same moment", () => {
    expect(workingHoursBetween(`${MON}T10:00`, `${MON}T10:00`)).toBe(0);
    expect(workingHoursBetween(`${MON}T10:00:00Z`, `${MON}T10:00`)).toBe(0);
  });

  it("is null when the end comes before the start", () => {
    expect(workingHoursBetween(`${MON}T10:00`, `${MON}T09:59`)).toBeNull();
    expect(workingHoursBetween(MON, FRI)).toBeNull();
  });

  it("is null for a bad time or window", () => {
    expect(workingHoursBetween("Monday", `${MON}T10:00`)).toBeNull();
    expect(workingHoursBetween(`${MON}T10:00`, "2026-02-30")).toBeNull();
    const bad: WorkingWindowMinutes[] = [
      { startMinute: 600, endMinute: 600 },
      { startMinute: 700, endMinute: 600 },
      { startMinute: -1, endMinute: 600 },
      { startMinute: 0, endMinute: 1441 },
      { startMinute: Number.NaN, endMinute: 600 },
    ];
    for (const w of bad)
      expect(workingHoursBetween(FRI, MON, DEFAULT_CALENDAR, w), JSON.stringify(w)).toBeNull();
    expect(
      workingHoursBetween(FRI, MON, DEFAULT_CALENDAR, { startMinute: 0, endMinute: 1440 })
    ).toBe(24);
  });

  it("agrees with a minute-by-minute count over random spans", () => {
    const calendar: WorkingCalendar = {
      workingDays: [1, 2, 3, 4, 5],
      holidays: ["2026-10-21", "2026-11-02"],
    };
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const start = isoDayNumber("2026-10-10") as number;
    const pad = (n: number) => String(n).padStart(2, "0");
    const at = (day: number, minute: number) =>
      `${isoFromDayNumber(day)}T${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
    for (let k = 0; k < 40; k++) {
      const a = start + Math.floor(rand() * 20);
      const b = a + Math.floor(rand() * 12);
      const ma = Math.floor(rand() * 1440);
      const mb = b === a ? ma + Math.floor(rand() * (1440 - ma)) : Math.floor(rand() * 1440);
      const window = rand() < 0.5 ? undefined : NINE_TO_FIVE;
      let minutes = 0;
      for (let t = a * 1440 + ma; t < b * 1440 + mb; t++) {
        const day = Math.floor(t / 1440);
        const m = t % 1440;
        if (!isWorkingDay(isoFromDayNumber(day), calendar)) continue;
        if (window && (m < window.startMinute || m >= window.endMinute)) continue;
        minutes++;
      }
      expect(workingHoursBetween(at(a, ma), at(b, mb), calendar, window)).toBeCloseTo(
        minutes / 60,
        9
      );
    }
  });
});
