import type { HolidayId, HolidayWindow } from "../types";

const TIMEZONE = "Africa/Cairo";

/**
 * Compute today's ISO date (YYYY-MM-DD) in Africa/Cairo — the authoritative
 * clock for all Egyptian holiday detection, independent of user locale.
 */
export function todayInCairo(date: Date = new Date()): { y: number; m: number; d: number; iso: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(date);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);
  const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return { y, m, d, iso };
}

export function isoFor(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function single(id: HolidayId, year: number, month: number, day: number): { id: HolidayId; window: HolidayWindow } {
  const iso = isoFor(year, month, day);
  return { id, window: { startISO: iso, endISO: iso } };
}

/**
 * All Gregorian holidays observed in Egypt, returned as windows in Africa/Cairo
 * time. Single-day events have startISO === endISO.
 */
export function getGregorianHolidays(year: number): Array<{ id: HolidayId; window: HolidayWindow }> {
  return [
    single("new-year", year, 1, 1),
    single("coptic-christmas", year, 1, 7),
    single("jan-25", year, 1, 25),
    single("mothers-day", year, 3, 21),
    single("earth-day", year, 4, 22),
    single("sinai-liberation", year, 4, 25),
    single("labour-day", year, 5, 1),
    single("jun-30", year, 6, 30),
    single("jul-23", year, 7, 23),
    single("halloween", year, 10, 31),
  ];
}
