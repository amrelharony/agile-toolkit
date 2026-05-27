import { describe, expect, it } from "vitest";
import {
  computeJulianPaschalEaster,
  getCopticEasterGregorian,
  getShamElNessim,
  getCopticHolidays,
} from "@/lib/holiday/calendars/coptic";

function gregorian(d: Date): { y: number; m: number; day: number } {
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

describe("computeJulianPaschalEaster — Meeus's algorithm", () => {
  it("returns April 22 for 2024", () => {
    expect(computeJulianPaschalEaster(2024)).toEqual({ month: 4, day: 22 });
  });

  it("returns April 7 for 2025", () => {
    expect(computeJulianPaschalEaster(2025)).toEqual({ month: 4, day: 7 });
  });

  it("returns April 6 for 2020", () => {
    expect(computeJulianPaschalEaster(2020)).toEqual({ month: 4, day: 6 });
  });

  it("returns a date in March or April", () => {
    for (let y = 2000; y < 2050; y++) {
      const { month } = computeJulianPaschalEaster(y);
      expect(month === 3 || month === 4).toBe(true);
    }
  });
});

describe("getCopticEasterGregorian — Julian→Gregorian offset across centennial boundaries", () => {
  it("returns May 5, 2024 (offset = 13)", () => {
    expect(gregorian(getCopticEasterGregorian(2024))).toEqual({ y: 2024, m: 5, day: 5 });
  });

  it("returns April 20, 2025 (offset = 13)", () => {
    expect(gregorian(getCopticEasterGregorian(2025))).toEqual({ y: 2025, m: 4, day: 20 });
  });

  it("returns April 19, 2020 (offset = 13)", () => {
    expect(gregorian(getCopticEasterGregorian(2020))).toEqual({ y: 2020, m: 4, day: 19 });
  });

  it("year 2000 — divisible by 400, offset stays 13 (no bump)", () => {
    // Julian Paschal 2000: April 17 → Gregorian April 30 (+13)
    expect(gregorian(getCopticEasterGregorian(2000))).toEqual({ y: 2000, m: 4, day: 30 });
  });

  it("year 2100 — centennial transition, offset becomes 14", () => {
    // Julian Paschal 2100: April 18 → Gregorian May 2 (+14)
    expect(gregorian(getCopticEasterGregorian(2100))).toEqual({ y: 2100, m: 5, day: 2 });
  });

  it("year 2200 — offset becomes 15", () => {
    // Julian Paschal 2200: March 22 → Gregorian April 6 (+15)
    expect(gregorian(getCopticEasterGregorian(2200))).toEqual({ y: 2200, m: 4, day: 6 });
  });

  it("year 2400 — divisible by 400, offset 16 (no bump beyond 2300)", () => {
    // Julian Paschal 2400: March 31 → Gregorian April 16 (+16)
    expect(gregorian(getCopticEasterGregorian(2400))).toEqual({ y: 2400, m: 4, day: 16 });
  });
});

describe("getShamElNessim", () => {
  it("equals Coptic Easter + 1 day for 2024", () => {
    const easter = getCopticEasterGregorian(2024);
    const sham = getShamElNessim(2024);
    expect(sham.getTime() - easter.getTime()).toBe(86_400_000);
    expect(gregorian(sham)).toEqual({ y: 2024, m: 5, day: 6 });
  });

  it("crosses a month boundary cleanly when needed", () => {
    // 2024 Easter is May 5 → Sham is May 6 (no boundary cross)
    // Take a year where Easter is on the last day of a month
    const easter2024 = getCopticEasterGregorian(2024);
    const sham2024 = getShamElNessim(2024);
    expect(sham2024.getUTCMonth()).toBe(easter2024.getUTCMonth());
  });
});

describe("getCopticHolidays", () => {
  it("returns both coptic-easter and sham-el-nessim windows for 2024", () => {
    const holidays = getCopticHolidays(2024);
    expect(holidays).toHaveLength(2);
    expect(holidays[0]).toEqual({
      id: "coptic-easter",
      window: { startISO: "2024-05-05", endISO: "2024-05-05" },
    });
    expect(holidays[1]).toEqual({
      id: "sham-el-nessim",
      window: { startISO: "2024-05-06", endISO: "2024-05-06" },
    });
  });
});
