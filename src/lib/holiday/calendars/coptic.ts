import type { HolidayId, HolidayWindow } from "../types";
import { isoFor } from "./gregorian";

/**
 * Meeus's Julian algorithm for the date of Paschal Full Moon → Easter in the
 * Julian calendar.  Returns the month (3 = March, 4 = April) and day in Julian.
 * Valid for any year in the 20th/21st/22nd centuries.
 *
 * Reference: Jean Meeus, "Astronomical Algorithms" (2nd ed.), Chapter 8.
 */
export function computeJulianPaschalEaster(year: number): { month: number; day: number } {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  return { month, day };
}

/**
 * Julian → Gregorian offset (days) for a given year. The offset grows
 * by one day at each non-divisible-by-400 centennial transition (1900,
 * 2100, 2200 — but NOT 2000, 2400). Without this, the hard-coded +13
 * offset (correct only for 1900-2099) silently shifts Coptic Easter
 * one day late starting in March 2100. (BUG-L4)
 */
function julianGregorianOffset(year: number, monthOneBased: number): number {
  // Formula per Calendrical Calculations (Reingold & Dershowitz):
  //   offset = floor(year/100) - floor(year/400) - 2
  // The centennial transition itself happens on March 1 of that year,
  // so January/February of a transition year still use the prior offset.
  const y = monthOneBased < 3 ? year - 1 : year;
  return Math.floor(y / 100) - Math.floor(y / 400) - 2;
}

function julianToGregorian(year: number, month: number, day: number): Date {
  const jd = Date.UTC(year, month - 1, day);
  const offsetDays = julianGregorianOffset(year, month);
  return new Date(jd + offsetDays * 86_400_000);
}

/** Coptic Orthodox Easter in the Gregorian calendar for the given year. */
export function getCopticEasterGregorian(year: number): Date {
  const { month, day } = computeJulianPaschalEaster(year);
  return julianToGregorian(year, month, day);
}

/** Sham El-Nessim = Easter Monday following Coptic Easter. */
export function getShamElNessim(year: number): Date {
  const easter = getCopticEasterGregorian(year);
  return new Date(easter.getTime() + 86_400_000);
}

/** Return the Coptic-based holidays as {id, window} with absolute Gregorian ISO dates. */
export function getCopticHolidays(year: number): Array<{ id: HolidayId; window: HolidayWindow }> {
  const easter = getCopticEasterGregorian(year);
  const sham = getShamElNessim(year);

  const easterIso = isoFor(easter.getUTCFullYear(), easter.getUTCMonth() + 1, easter.getUTCDate());
  const shamIso = isoFor(sham.getUTCFullYear(), sham.getUTCMonth() + 1, sham.getUTCDate());

  return [
    { id: "coptic-easter", window: { startISO: easterIso, endISO: easterIso } },
    { id: "sham-el-nessim", window: { startISO: shamIso, endISO: shamIso } },
  ];
}
