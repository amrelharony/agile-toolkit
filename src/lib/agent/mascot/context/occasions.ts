/**
 * The days Amr marks, by Cairo's calendar: Islamic days by the Umm al-Qura
 * Hijri calendar, Coptic Easter by the Julian computus, and Egyptian national
 * and international days by date. The rules follow amrelharony.com's holiday
 * engine (Js/holiday-engine.js), reusing the toolkit's own calendars
 * (src/lib/holiday/calendars), so the site's themes and Amr agree on the day.
 *
 * Amr is Egyptian, so every visitor gets Cairo's days wherever they are; their
 * own clock and weather come in elsewhere (moments.ts). Pure.
 */

import { getHijriDate } from "@/lib/holiday/calendars/islamic";
import { isoFor, todayInCairo } from "@/lib/holiday/calendars/gregorian";
import { getCopticEasterGregorian } from "@/lib/holiday/calendars/coptic";

export type OccasionId =
  // Islamic (Hijri)
  | "ramadan"
  | "eid-fitr"
  | "arafah"
  | "eid-adha"
  | "hijri-new-year"
  | "ashura"
  | "isra-miraj"
  | "mid-shaban"
  | "mawlid"
  // Egyptian national days
  | "jan-25"
  | "sinai-liberation"
  | "jun-30"
  | "jul-23"
  | "suez-canal"
  | "oct-6"
  // Coptic
  | "coptic-christmas"
  | "coptic-easter"
  | "sham-el-nessim"
  | "nayrouz"
  // International
  | "new-year"
  | "nye"
  | "christmas"
  | "valentine"
  | "womens-day"
  | "mothers-day"
  | "earth-day"
  | "environment-day"
  | "peace-day"
  | "labour-day"
  | "teachers-day"
  | "pi-day"
  | "april-fools"
  | "halloween";

/**
 * Which day wins when two fall together. Ramadan lasts a month, so any single
 * day inside it takes the greeting that day; Ramadan's own scenes stay in play.
 */
export const OCCASION_PRIORITY: Record<OccasionId, number> = {
  "eid-fitr": 100,
  "eid-adha": 100,
  arafah: 95,
  "jan-25": 90,
  "sinai-liberation": 90,
  "jun-30": 90,
  "jul-23": 90,
  "suez-canal": 90,
  "oct-6": 90,
  "coptic-christmas": 88,
  "coptic-easter": 85,
  "sham-el-nessim": 85,
  "new-year": 84,
  nye: 84,
  "hijri-new-year": 82,
  mawlid: 80,
  "isra-miraj": 78,
  "mid-shaban": 76,
  ashura: 76,
  nayrouz: 74,
  christmas: 72,
  "mothers-day": 70,
  "womens-day": 60,
  valentine: 60,
  "labour-day": 58,
  "teachers-day": 56,
  "earth-day": 54,
  "environment-day": 54,
  "peace-day": 52,
  halloween: 50,
  "april-fools": 48,
  "pi-day": 46,
  ramadan: 40,
};

const DAY_MS = 86_400_000;

/** A Gregorian date as Cairo's YYYY-MM-DD. */
function cairoIso(d: Date): string {
  const c = todayInCairo(d);
  return c.iso;
}

/** Coptic Easter as YYYY-MM-DD (the computus gives a UTC midnight). */
function easterIso(year: number, plusDays = 0): string {
  const e = new Date(getCopticEasterGregorian(year).getTime() + plusDays * DAY_MS);
  return isoFor(e.getUTCFullYear(), e.getUTCMonth() + 1, e.getUTCDate());
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/**
 * Nayrouz, the Coptic New Year: 11 September, or 12 September in the year
 * before a Gregorian leap year (the Coptic leap day falls just before it).
 */
export function nayrouzDay(year: number): number {
  return isLeap(year + 1) ? 12 : 11;
}

/** Every occasion on this Cairo day, the most important first. */
export function occasionsOn(date: Date = new Date()): OccasionId[] {
  const { y, m, d, iso } = todayInCairo(date);
  const h = getHijriDate(date);
  const on: OccasionId[] = [];
  const add = (id: OccasionId, when: boolean) => {
    if (when) on.push(id);
  };

  // Islamic, by the Umm al-Qura calendar in Cairo.
  add("ramadan", h.hMonth === 9);
  add("eid-fitr", h.hMonth === 10 && h.hDay >= 1 && h.hDay <= 3);
  add("arafah", h.hMonth === 12 && h.hDay === 9);
  add("eid-adha", h.hMonth === 12 && h.hDay >= 10 && h.hDay <= 13);
  add("isra-miraj", h.hMonth === 7 && h.hDay === 27);
  add("mawlid", h.hMonth === 3 && h.hDay === 12);
  add("mid-shaban", h.hMonth === 8 && h.hDay === 15);
  add("hijri-new-year", h.hMonth === 1 && h.hDay === 1);
  add("ashura", h.hMonth === 1 && h.hDay === 10);

  // Egyptian national days.
  add("jan-25", m === 1 && d === 25);
  add("sinai-liberation", m === 4 && d === 25);
  add("jun-30", m === 6 && d === 30);
  add("jul-23", m === 7 && d === 23);
  add("suez-canal", m === 7 && d === 26);
  add("oct-6", m === 10 && d === 6);

  // Coptic.
  add("coptic-christmas", m === 1 && d === 7);
  add("coptic-easter", iso === easterIso(y));
  add("sham-el-nessim", iso === easterIso(y, 1));
  add("nayrouz", m === 9 && d === nayrouzDay(y));

  // International.
  add("new-year", m === 1 && d === 1);
  add("nye", m === 12 && d === 31);
  add("christmas", m === 12 && (d === 24 || d === 25));
  add("valentine", m === 2 && d === 14);
  add("womens-day", m === 3 && d === 8);
  add("mothers-day", m === 3 && d === 21);
  add("pi-day", m === 3 && d === 14);
  add("april-fools", m === 4 && d === 1);
  add("earth-day", m === 4 && d === 22);
  add("labour-day", m === 5 && d === 1);
  add("environment-day", m === 6 && d === 5);
  add("peace-day", m === 9 && d === 21);
  add("teachers-day", m === 10 && d === 5);
  add("halloween", m === 10 && d >= 25 && d <= 31);

  return on.sort((a, b) => OCCASION_PRIORITY[b] - OCCASION_PRIORITY[a]);
}

/** Cairo's date, for remembering what he has already marked today. */
export function cairoDay(date: Date = new Date()): string {
  return cairoIso(date);
}
