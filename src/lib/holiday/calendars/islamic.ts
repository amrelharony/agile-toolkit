import type { HolidayId, HolidayWindow } from "../types";
import { isoFor, todayInCairo } from "./gregorian";

const TIMEZONE = "Africa/Cairo";

export interface HijriDate {
  hYear: number;
  hMonth: number;
  hDay: number;
}

/**
 * Extract the Umm al-Qura (Saudi authoritative) Hijri date for a given Gregorian
 * instant, evaluated in Africa/Cairo time.  Uses Intl.DateTimeFormat with the
 * islamic-umalqura calendar — fully supported in all modern browsers.
 */
export function getHijriDate(date: Date = new Date()): HijriDate {
  const fmt = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  const parts = fmt.formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value ?? "0";
  const month = parts.find((p) => p.type === "month")?.value ?? "0";
  const day = parts.find((p) => p.type === "day")?.value ?? "0";

  // Intl can return Arabic-Indic digits in some locales ("١٤٤٦") — normalize
  // them to ASCII before parsing.  Also strips any "AH" era suffix.
  const hYear = toInt(year);
  const hMonth = toInt(month);
  const hDay = toInt(day);
  return { hYear, hMonth, hDay };
}

export function toInt(raw: string): number {
  // Map Arabic-Indic (U+0660..U+0669) and Extended Arabic-Indic (U+06F0..U+06F9) digits to ASCII
  const normalized = String(raw).replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (d) => {
    const code = d.charCodeAt(0);
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });
  const parsed = parseInt(normalized.replace(/\D/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Scan a ±45-day window around `now` to find contiguous Gregorian dates that
 * fall within the requested Hijri month + day range.  Returns the first such
 * window.  Used to map shifting Hijri holidays back to a concrete Gregorian
 * range for theme scheduling.
 */
function findGregorianRangeForHijri(
  hMonth: number,
  hDayStart: number,
  hDayEnd: number,
  fromDate: Date = new Date()
): HolidayWindow | null {
  const dayMs = 86_400_000;
  // Anchor the scan at NOON UTC rather than `fromDate`'s wall-clock time.
  // Each step adds a fixed 24h of UTC, but every instant is mapped to a
  // *Cairo calendar date* (todayInCairo / getHijriDate). Cairo observes DST,
  // so stepping from an instant that sits near Cairo midnight makes the
  // spring-forward day advance the Cairo date by TWO days in a single step —
  // skipping a calendar day. A single-day Hijri holiday landing on the
  // skipped day would then go undetected (and a multi-day window's start
  // would be reported a day late). Noon UTC is 14:00–15:00 in Cairo
  // year-round (UTC+2/+3), nowhere near a midnight boundary, so consecutive
  // 24h-UTC steps always advance the Cairo date by exactly one — DST-safe.
  const base = new Date(fromDate);
  base.setUTCHours(12, 0, 0, 0);
  const rangeStartTs = base.getTime() - 45 * dayMs;
  const rangeEndTs = base.getTime() + 45 * dayMs;

  let startIso: string | null = null;
  let endIso: string | null = null;

  for (let ts = rangeStartTs; ts <= rangeEndTs; ts += dayMs) {
    const d = new Date(ts);
    const hijri = getHijriDate(d);
    const inside = hijri.hMonth === hMonth && hijri.hDay >= hDayStart && hijri.hDay <= hDayEnd;
    const cairo = todayInCairo(d);
    const iso = isoFor(cairo.y, cairo.m, cairo.d);
    if (inside) {
      if (!startIso) startIso = iso;
      endIso = iso;
    } else if (startIso) {
      break;
    }
  }

  if (!startIso || !endIso) return null;
  return { startISO: startIso, endISO: endIso };
}

/**
 * Islamic Umm al-Qura holiday detection.  Returns only holidays whose Gregorian
 * window overlaps with a ±45-day scan around `now` so the detection stays cheap.
 */
export function getIslamicHolidays(
  now: Date = new Date()
): Array<{ id: HolidayId; window: HolidayWindow }> {
  const out: Array<{ id: HolidayId; window: HolidayWindow }> = [];

  const push = (id: HolidayId, w: HolidayWindow | null) => {
    if (w) out.push({ id, window: w });
  };

  // Ramadan — entire month 9 (variable 29 or 30 days)
  push("ramadan", findGregorianRangeForHijri(9, 1, 30, now));
  // Eid al-Fitr — 1-3 Shawwal (month 10)
  push("eid-fitr", findGregorianRangeForHijri(10, 1, 3, now));
  // Eid al-Adha — 10-13 Dhu al-Hijjah (month 12)
  push("eid-adha", findGregorianRangeForHijri(12, 10, 13, now));
  // Hijri New Year — 1 Muharram (month 1, day 1)
  push("hijri-new-year", findGregorianRangeForHijri(1, 1, 1, now));
  // Mawlid — 12 Rabi al-Awwal (month 3, day 12)
  push("mawlid", findGregorianRangeForHijri(3, 12, 12, now));

  return out;
}
