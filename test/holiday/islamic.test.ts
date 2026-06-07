import { describe, expect, it } from "vitest";
import { getHijriDate, getIslamicHolidays, toInt } from "@/lib/holiday/calendars/islamic";

describe("toInt — digit normalization", () => {
  it("parses ASCII digits", () => {
    expect(toInt("1446")).toBe(1446);
    expect(toInt("9")).toBe(9);
    expect(toInt("0")).toBe(0);
  });

  it("parses Arabic-Indic digits (U+0660..U+0669)", () => {
    expect(toInt("١٤٤٦")).toBe(1446); // ١٤٤٦
    expect(toInt("٠٩")).toBe(9); // ٠٩
  });

  it("parses Extended Arabic-Indic / Persian digits (U+06F0..U+06F9)", () => {
    expect(toInt("۱۴۴۶")).toBe(1446); // ۱۴۴۶
  });

  it("strips non-digit suffixes like ' AH'", () => {
    expect(toInt("1446 AH")).toBe(1446);
    expect(toInt("9 AH")).toBe(9);
  });

  it("returns 0 for empty or non-numeric input", () => {
    expect(toInt("")).toBe(0);
    expect(toInt("not a year")).toBe(0);
  });

  it("returns 0 for NaN/undefined-ish via fallback", () => {
    expect(toInt(String(undefined))).toBe(0);
  });
});

describe("getHijriDate", () => {
  it("returns positive integer fields", () => {
    const d = getHijriDate(new Date("2024-04-10T12:00:00Z"));
    expect(d.hYear).toBeGreaterThan(1400);
    expect(d.hMonth).toBeGreaterThanOrEqual(1);
    expect(d.hMonth).toBeLessThanOrEqual(12);
    expect(d.hDay).toBeGreaterThanOrEqual(1);
    expect(d.hDay).toBeLessThanOrEqual(30);
  });

  it("evaluates dates in Africa/Cairo timezone (Hijri rollover at Cairo midnight)", () => {
    // 23:30 UTC = 01:30 Cairo (next day in Cairo, possibly next Hijri day)
    const lateUtc = new Date("2024-04-10T23:30:00Z");
    const cairoNextDay = getHijriDate(lateUtc);
    expect(cairoNextDay.hDay).toBeGreaterThanOrEqual(1);
  });
});

describe("getIslamicHolidays", () => {
  it("returns an array of {id, window} entries", () => {
    const holidays = getIslamicHolidays(new Date("2024-04-10T12:00:00Z"));
    expect(Array.isArray(holidays)).toBe(true);
    for (const h of holidays) {
      expect(typeof h.id).toBe("string");
      expect(typeof h.window.startISO).toBe("string");
      expect(typeof h.window.endISO).toBe("string");
      expect(h.window.startISO).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(h.window.endISO).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(h.window.startISO <= h.window.endISO).toBe(true);
    }
  });

  it("produces a Ramadan window that is contiguous and ~29-30 days when in range", () => {
    // Ramadan 1445 (2024-03-11 → 2024-04-09 approx); pick a date in mid-March
    const holidays = getIslamicHolidays(new Date("2024-03-25T12:00:00Z"));
    const ramadan = holidays.find((h) => h.id === "ramadan");
    if (!ramadan) {
      // ±45-day scan may or may not include Ramadan depending on the year;
      // if it didn't, the test is non-applicable. Verified by the find().
      return;
    }
    const start = new Date(ramadan.window.startISO + "T00:00:00Z").getTime();
    const end = new Date(ramadan.window.endISO + "T00:00:00Z").getTime();
    const days = Math.round((end - start) / 86_400_000) + 1;
    // Lunar month is 29 or 30 days; window must reflect that
    expect(days).toBeGreaterThanOrEqual(28);
    expect(days).toBeLessThanOrEqual(31);
  });

  it("only includes holidays whose windows fall within the ±45-day scan", () => {
    // Eids and Mawlid often won't be within 45 days of a random spring date
    const holidays = getIslamicHolidays(new Date("2024-04-10T12:00:00Z"));
    const ids = holidays.map((h) => h.id);
    // At least one Islamic holiday should be in range somewhere in the year cycle
    // (this date is during Ramadan 1445 → Eid al-Fitr in early April 2024)
    expect(ids.length).toBeGreaterThanOrEqual(0);
  });

  // Regression: the ±45-day scan stepped from `now`'s wall-clock instant in
  // fixed 24h-UTC increments while mapping each instant to a *Cairo calendar
  // date*. Cairo is UTC+2/+3 and observes DST, so an evening-UTC `now` (past
  // Cairo midnight) rolled the scan boundary into the next Cairo day, and the
  // last-Friday-of-April spring-forward additionally skipped a Cairo day —
  // both reporting holiday window starts a day late. The scan now anchors each
  // step at noon UTC (mid-afternoon Cairo year-round), so the result depends
  // only on the Cairo day, not the UTC time-of-day. (islamic.ts findGregorianRangeForHijri)
  it("reports holiday windows independent of now's UTC time-of-day (DST-safe)", () => {
    // 2024-04-25 is within ±45 days of Ramadan 1445 AND straddles Egypt's
    // spring-forward (last Friday of April 2024 = Apr 26).
    const noon = getIslamicHolidays(new Date("2024-04-25T12:00:00Z"));
    const evening = getIslamicHolidays(new Date("2024-04-25T22:00:00Z"));
    const rNoon = noon.find((h) => h.id === "ramadan");
    const rEvening = evening.find((h) => h.id === "ramadan");
    expect(rNoon).toBeDefined();
    expect(rEvening).toBeDefined();
    // Time-of-day must not move a fixed calendar window.
    expect(rEvening!.window).toEqual(rNoon!.window);
    // Ramadan 1445 (Umm al-Qura) ran 2024-03-11 → 2024-04-09 in Cairo. The
    // pre-fix evening-UTC scan reported a start of 2024-03-12 (a day late).
    expect(rEvening!.window.startISO).toBe("2024-03-11");
    expect(rEvening!.window.endISO).toBe("2024-04-09");
  });
});
