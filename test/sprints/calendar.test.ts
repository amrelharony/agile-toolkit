/**
 * Working days: the team's week and holidays, counted half-open (the work of
 * the days before a date), constant time over long ranges, and the inverse
 * (`addWorkingDays`) landing on the earliest date with that many done.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_CALENDAR,
  MAX_HOLIDAYS,
  addWorkingDays,
  isIsoDate,
  isWorkingDay,
  isoDayNumber,
  isoFromDayNumber,
  normalizeCalendar,
  weekdayOf,
  workingDaysBetween,
  type WorkingCalendar,
} from "@/lib/sprints/calendar";

// Monday 19 October 2026.
const MON = "2026-10-19";

/** Working days in [from, to), one day at a time. */
function bruteForce(from: string, to: string, calendar: WorkingCalendar): number {
  const a = isoDayNumber(from)!;
  const b = isoDayNumber(to)!;
  let n = 0;
  for (let d = a; d < b; d++) if (isWorkingDay(isoFromDayNumber(d), calendar)) n++;
  return n;
}

/** A small deterministic generator, so the property checks are repeatable. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

describe("dates", () => {
  it("reads YYYY-MM-DD (ignoring a time), rolling an impossible day over as sprints always have", () => {
    expect(isoFromDayNumber(isoDayNumber(MON)!)).toBe(MON);
    expect(isoDayNumber("2026-10-19T23:59:00+05:00")).toBe(isoDayNumber(MON));
    expect(isoFromDayNumber(isoDayNumber("2026-09-31")!)).toBe("2026-10-01");
    expect(isoDayNumber("19/10/2026")).toBeNull();
    expect(isoDayNumber("")).toBeNull();
    expect(isoDayNumber(undefined)).toBeNull();
  });

  it("isIsoDate is the strict check", () => {
    expect(isIsoDate(MON)).toBe(true);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-09-31")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("junk")).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });

  it("knows the weekday", () => {
    expect(weekdayOf(MON)).toBe(1);
    expect(weekdayOf("2026-10-24")).toBe(6);
    expect(weekdayOf("2026-10-25")).toBe(0);
    expect(weekdayOf("1970-01-01")).toBe(4);
    expect(weekdayOf("1969-12-31")).toBe(3);
    expect(weekdayOf("nope")).toBeNull();
  });
});

describe("normalizeCalendar", () => {
  it("defaults to Monday to Friday with no holidays", () => {
    expect(normalizeCalendar(undefined)).toEqual(DEFAULT_CALENDAR);
    expect(normalizeCalendar({})).toEqual({ workingDays: [1, 2, 3, 4, 5], holidays: [] });
  });

  it("drops bad weekdays and dates, sorts and de-duplicates", () => {
    expect(
      normalizeCalendar({
        workingDays: [6, 0, 6, 9, "x", 2.5],
        holidays: ["2026-12-25", "2026-12-24", "2026-12-25", "2026-02-30", 7, "soon"],
      })
    ).toEqual({ workingDays: [0, 6], holidays: ["2026-12-24", "2026-12-25"] });
  });

  it("falls back to the default week when no valid working day is left", () => {
    expect(normalizeCalendar({ workingDays: [] }).workingDays).toEqual([1, 2, 3, 4, 5]);
    expect(normalizeCalendar({ workingDays: [7, -1] }).workingDays).toEqual([1, 2, 3, 4, 5]);
  });

  it("keeps the latest holidays when there are too many", () => {
    const start = isoDayNumber("2020-01-01")!;
    const many = Array.from({ length: MAX_HOLIDAYS + 10 }, (_, i) => isoFromDayNumber(start + i));
    const kept = normalizeCalendar({ holidays: many }).holidays;
    expect(kept).toHaveLength(MAX_HOLIDAYS);
    expect(kept[kept.length - 1]).toBe(many[many.length - 1]);
    expect(kept[0]).toBe(many[10]);
  });
});

describe("isWorkingDay", () => {
  it("is a working weekday that isn't a holiday", () => {
    expect(isWorkingDay(MON)).toBe(true);
    expect(isWorkingDay("2026-10-24")).toBe(false); // Saturday
    expect(isWorkingDay(MON, { workingDays: [1, 2, 3, 4, 5], holidays: [MON] })).toBe(false);
    expect(isWorkingDay("2026-10-25", { workingDays: [0, 1, 2, 3, 4], holidays: [] })).toBe(true);
    expect(isWorkingDay("not a date")).toBe(false);
  });
});

describe("workingDaysBetween", () => {
  it("counts the working dates from the first up to, not including, the second", () => {
    expect(workingDaysBetween(MON, "2026-10-20")).toBe(1);
    expect(workingDaysBetween(MON, "2026-10-24")).toBe(5); // Mon–Fri done by Saturday
    expect(workingDaysBetween(MON, "2026-10-26")).toBe(5); // the weekend adds nothing
    expect(workingDaysBetween(MON, "2026-11-02")).toBe(10);
    expect(workingDaysBetween("2026-10-24", "2026-10-26")).toBe(0); // a weekend
  });

  it("is 0 for an empty or backwards range and null for a bad date", () => {
    expect(workingDaysBetween(MON, MON)).toBe(0);
    expect(workingDaysBetween("2026-10-26", MON)).toBe(0);
    expect(workingDaysBetween(MON, "junk")).toBeNull();
    expect(workingDaysBetween("", MON)).toBeNull();
  });

  it("takes out holidays on working days only, once each", () => {
    const cal: WorkingCalendar = {
      workingDays: [1, 2, 3, 4, 5],
      // Wednesday twice (a hand-edited list), a Saturday, and one outside the range.
      holidays: ["2026-10-21", "2026-10-21", "2026-10-24", "2026-12-25"],
    };
    expect(workingDaysBetween(MON, "2026-11-02", cal)).toBe(9);
    expect(workingDaysBetween("2026-10-21", "2026-10-22", cal)).toBe(0);
  });

  it("follows a custom week (Sunday to Thursday)", () => {
    const cal: WorkingCalendar = { workingDays: [0, 1, 2, 3, 4], holidays: [] };
    expect(workingDaysBetween("2026-10-18", "2026-10-25", cal)).toBe(5);
    expect(workingDaysBetween("2026-10-23", "2026-10-25", cal)).toBe(0); // Fri, Sat off
  });

  it("matches a day-by-day count on random ranges and calendars", () => {
    const rand = rng(42);
    const base = isoDayNumber("2025-01-01")!;
    for (let i = 0; i < 200; i++) {
      const a = base + Math.floor(rand() * 900);
      const b = a + Math.floor(rand() * 60) - 5;
      const workingDays = [0, 1, 2, 3, 4, 5, 6].filter(() => rand() < 0.6);
      const holidays = Array.from({ length: 6 }, () =>
        isoFromDayNumber(base + Math.floor(rand() * 960))
      );
      const cal = normalizeCalendar({ workingDays, holidays });
      const from = isoFromDayNumber(a);
      const to = isoFromDayNumber(b);
      expect(workingDaysBetween(from, to, cal)).toBe(Math.max(0, bruteForce(from, to, cal)));
    }
  });

  it("handles a two-century range at once", () => {
    // 1 Jan 1900 to 1 Jan 2100: 73,049 days, 10,435 whole weeks plus four days
    // starting on a Monday.
    expect(workingDaysBetween("1900-01-01", "2100-01-01")).toBe(10_435 * 5 + 4);
  });
});

describe("addWorkingDays", () => {
  it("lands on the morning after the n-th working day", () => {
    expect(addWorkingDays(MON, 1)).toBe("2026-10-20");
    expect(addWorkingDays("2026-10-23", 1)).toBe("2026-10-24"); // Friday's work, done by Saturday
    expect(addWorkingDays(MON, 5)).toBe("2026-10-24");
    expect(addWorkingDays(MON, 6)).toBe("2026-10-27");
    expect(addWorkingDays("2026-10-24", 1)).toBe("2026-10-27"); // from a Saturday
  });

  it("skips holidays", () => {
    const cal = normalizeCalendar({ holidays: ["2026-10-20"] });
    expect(addWorkingDays(MON, 2, cal)).toBe("2026-10-22");
  });

  it("gives the start for 0, a negative or a non-number, and rounds a fraction up", () => {
    expect(addWorkingDays(MON, 0)).toBe(MON);
    expect(addWorkingDays(MON, -3)).toBe(MON);
    expect(addWorkingDays(MON, Number.NaN)).toBe(MON);
    expect(addWorkingDays(MON, 2.2)).toBe(addWorkingDays(MON, 3));
    expect(addWorkingDays("junk", 3)).toBeNull();
  });

  it("is the earliest date with exactly n working days done", () => {
    const rand = rng(7);
    const base = isoDayNumber("2026-01-01")!;
    for (let i = 0; i < 200; i++) {
      const from = isoFromDayNumber(base + Math.floor(rand() * 365));
      const n = 1 + Math.floor(rand() * 40);
      const cal = normalizeCalendar({
        workingDays: [0, 1, 2, 3, 4, 5, 6].filter(() => rand() < 0.7),
        holidays: Array.from({ length: 5 }, () =>
          isoFromDayNumber(base + Math.floor(rand() * 420))
        ),
      });
      const to = addWorkingDays(from, n, cal)!;
      expect(workingDaysBetween(from, to, cal)).toBe(n);
      const dayBefore = isoFromDayNumber(isoDayNumber(to)! - 1);
      expect(workingDaysBetween(from, dayBefore, cal)).toBe(n - 1);
    }
  });

  it("copes with a huge n", () => {
    const to = addWorkingDays(MON, 10_000)!;
    expect(workingDaysBetween(MON, to)).toBe(10_000);
  });
});
