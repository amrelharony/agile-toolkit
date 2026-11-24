/**
 * Time zones, by their IANA names ("Africa/Cairo"): what the browser's (or
 * the server's) Intl knows. Pure and server-safe; the Team Time CRUD and the
 * page check zones with the same rule. The tool may extend it.
 *
 * Every function takes its zone and its instant as arguments: nothing here
 * reads the machine's own zone, so the page, Amr's verbs and the tests agree.
 * Days are "YYYY-MM-DD", times "HH:MM", instants epoch milliseconds or Dates.
 */

import { isoDayNumber, isoFromDayNumber, weekdayOf } from "@/lib/sprints/calendar";

/** Whether `zone` is a time zone Intl knows. */
export function isTimeZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || zone.trim() === "") return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Zones already spelled out, by what was asked for (null: Intl doesn't know it). */
const canonicalCache = new Map<string, string | null>();

/**
 * The zone's canonical spelling, as Intl resolves it (any case in, the
 * IANA name out); null when it isn't a zone Intl knows.
 */
export function canonicalZone(zone: string): string | null {
  const known = canonicalCache.get(zone);
  if (known !== undefined) return known;
  const out = isTimeZone(zone)
    ? new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions().timeZone
    : null;
  if (canonicalCache.size < 2000) canonicalCache.set(zone, out);
  return out;
}

/** A short list for a runtime without `Intl.supportedValuesOf`: one or two zones per offset. */
const FALLBACK_ZONES = [
  "Pacific/Honolulu",
  "America/Anchorage",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Toronto",
  "America/Mexico_City",
  "America/Bogota",
  "America/Sao_Paulo",
  "America/Argentina/Buenos_Aires",
  "Atlantic/Azores",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Lisbon",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Amsterdam",
  "Europe/Warsaw",
  "Europe/Athens",
  "Europe/Istanbul",
  "Africa/Lagos",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Africa/Nairobi",
  "Asia/Riyadh",
  "Asia/Dubai",
  "Asia/Tehran",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Kathmandu",
  "Asia/Dhaka",
  "Asia/Bangkok",
  "Asia/Jakarta",
  "Asia/Singapore",
  "Asia/Shanghai",
  "Asia/Manila",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Perth",
  "Australia/Adelaide",
  "Australia/Brisbane",
  "Australia/Sydney",
  "Pacific/Auckland",
];

let zoneList: string[] | null = null;

/**
 * Every zone Intl knows, plus "UTC", each in its canonical spelling and once,
 * sorted. A short built-in list stands in when the runtime can't list them.
 * Never assert exact names from it: runtimes differ.
 */
export function allZones(): string[] {
  if (zoneList) return zoneList;
  const list = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  let raw: string[] = FALLBACK_ZONES;
  try {
    if (typeof list === "function") raw = list("timeZone");
  } catch {
    raw = FALLBACK_ZONES;
  }
  const out = new Set<string>();
  for (const z of [...raw, "UTC"]) {
    const c = canonicalZone(z);
    if (c) out.add(c);
  }
  zoneList = Array.from(out).sort((a, b) => a.localeCompare(b));
  return zoneList;
}

/**
 * Today's IANA names for the old spellings a runtime may still resolve to
 * (V8 resolves "Asia/Kolkata" to "Asia/Calcutta" and "Europe/Kyiv" to
 * "Europe/Kiev"). Only for what people read and type: zones are stored and
 * compared in the runtime's canonical spelling.
 */
const CURRENT_NAMES: Readonly<Record<string, string>> = {
  "Africa/Asmera": "Africa/Asmara",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Catamarca": "America/Argentina/Catamarca",
  "America/Coral_Harbour": "America/Atikokan",
  "America/Cordoba": "America/Argentina/Cordoba",
  "America/Godthab": "America/Nuuk",
  "America/Indianapolis": "America/Indiana/Indianapolis",
  "America/Jujuy": "America/Argentina/Jujuy",
  "America/Louisville": "America/Kentucky/Louisville",
  "America/Mendoza": "America/Argentina/Mendoza",
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Europe/Kiev": "Europe/Kyiv",
  "Pacific/Enderbury": "Pacific/Kanton",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Truk": "Pacific/Chuuk",
};

/** A zone's name today, for people to read: "Asia/Kolkata" where the runtime says "Asia/Calcutta". */
export function currentZoneName(zone: string): string {
  return CURRENT_NAMES[zone] ?? zone;
}

/** A zone as people say it: its city today ("America/Toronto" → "Toronto", "Asia/Calcutta" → "Kolkata"), or "UTC". */
export function zoneLabel(zone: string): string {
  if (!zone) return "";
  if (zone === "UTC" || zone === "Etc/UTC") return "UTC";
  const name = currentZoneName(zone);
  const last = name.split("/").pop() ?? name;
  return last.replace(/_/g, " ");
}

/** One formatter per zone (making one is the slow part). */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    formatters.set(zone, f);
  }
  return f;
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** The wall clock in `zone` at `at`, as UTC milliseconds of that wall time (to the minute). */
function wallMs(zone: string, at: number): number {
  const parts = formatterFor(zone).formatToParts(new Date(at));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const hour = n("hour") % 24;
  return Date.UTC(n("year"), n("month") - 1, n("day"), hour, n("minute"));
}

const ms = (at: Date | number) => (typeof at === "number" ? at : at.getTime());

/**
 * The zone's offset from UTC at `at`, in minutes (Tokyo +540, New York −300
 * in winter). Throws on a zone Intl doesn't know: check with isTimeZone.
 */
export function offsetMinutes(zone: string, at: Date | number): number {
  const t = Math.floor(ms(at) / MINUTE_MS) * MINUTE_MS;
  return Math.round((wallMs(zone, t) - t) / MINUTE_MS);
}

/** What a clock in `zone` reads at `at`: the day, the minute of the day and the weekday. */
export interface LocalClock {
  /** "YYYY-MM-DD". */
  day: string;
  /** 0 to 1439. */
  minute: number;
  /** 0 Sunday to 6 Saturday. */
  weekday: number;
}

export function localClock(zone: string, at: Date | number): LocalClock {
  const wall = wallMs(zone, ms(at));
  const dayNumber = Math.floor(wall / DAY_MS);
  const day = isoFromDayNumber(dayNumber);
  return {
    day,
    minute: Math.round((wall - dayNumber * DAY_MS) / MINUTE_MS),
    weekday: weekdayOf(day) ?? 0,
  };
}

/** "HH:MM" as the minute of the day, or null. */
function clockMinute(time: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Instants already worked out, by zone, day and time (the same days come back often). */
const wallCache = new Map<string, number | null>();
const WALL_CACHE_MAX = 20_000;

/**
 * The instant a clock in `zone` reads `time` on `day`, or null for a day,
 * time or zone that isn't one. Safe across clock changes: a time inside a
 * spring-forward gap moves on to the first minute that exists (01:30 on the
 * night London skips from 01:00 to 02:00 gives 02:00), and a time that
 * happens twice when the clocks go back gives the earlier one.
 */
export function wallToUtc(day: string, time: string, zone: string): Date | null {
  const key = `${zone}|${day}|${time}`;
  const cached = wallCache.get(key);
  if (cached !== undefined) return cached === null ? null : new Date(cached);
  const at = findWallInstant(day, time, zone);
  if (wallCache.size >= WALL_CACHE_MAX) wallCache.clear();
  wallCache.set(key, at);
  return at === null ? null : new Date(at);
}

function findWallInstant(day: string, time: string, zone: string): number | null {
  const dayNumber = isoDayNumber(day);
  const minute = clockMinute(time);
  if (dayNumber === null || minute === null || canonicalZone(zone) === null) return null;
  if (isoFromDayNumber(dayNumber) !== day.slice(0, 10)) return null;
  const wall = dayNumber * DAY_MS + minute * MINUTE_MS;
  // The offsets a day either side: with at most one change between them,
  // one of the two gives the instant (both, when the time happens twice).
  const before = offsetMinutes(zone, wall - DAY_MS);
  const after = offsetMinutes(zone, wall + DAY_MS);
  const fits = [before, after]
    .map((o) => wall - o * MINUTE_MS)
    .filter((t) => wallMs(zone, t) === wall);
  if (fits.length > 0) return Math.min(...fits);
  // In a gap: the first minute after it is the change itself, between the
  // instant the earlier offset gives and the one the later offset gives.
  let lo = Math.min(wall - after * MINUTE_MS, wall - before * MINUTE_MS);
  let hi = Math.max(wall - after * MINUTE_MS, wall - before * MINUTE_MS);
  const late = offsetMinutes(zone, hi);
  while (hi - lo > MINUTE_MS) {
    const mid = Math.floor((lo + hi) / 2 / MINUTE_MS) * MINUTE_MS;
    if (offsetMinutes(zone, mid) === late) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** An offset as people read it: "UTC", "UTC+1", "UTC+5:30", "UTC-4". */
export function offsetLabel(minutes: number): string {
  if (minutes === 0) return "UTC";
  const sign = minutes > 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}
