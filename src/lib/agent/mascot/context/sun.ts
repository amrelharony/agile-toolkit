/**
 * Sunrise and sunset for a place and day, by the sunrise equation (the sun's
 * upper limb at the horizon, with standard refraction). Good to a minute or two
 * between the polar circles, which is plenty for knowing when iftar is near.
 * Used for Cairo when the visitor's own sun times aren't known. Pure.
 */

const RAD = Math.PI / 180;
const J2000 = 2451545;
const DAY_MS = 86_400_000;
/** The Unix epoch as a Julian date. */
const UNIX_JD = 2440587.5;

export const CAIRO = { lat: 30.0444, lon: 31.2357 } as const;

export interface SunTimes {
  /** null when the sun doesn't rise or set that day (polar day or night). */
  rise: Date | null;
  set: Date | null;
}

const fromJulian = (j: number) => new Date((j - UNIX_JD) * DAY_MS);

/** Sunrise and sunset on the UTC day of `date`, at latitude/longitude (east positive). */
export function sunTimes(date: Date, lat: number, lon: number): SunTimes {
  // The day number counts from J2000's noon, so start from this day's midnight.
  const midnightUtc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const jd = midnightUtc / DAY_MS + UNIX_JD;
  const n = Math.ceil(jd - J2000 + 0.0008);
  const jStar = n - lon / 360;
  const m = (357.5291 + 0.98560028 * jStar) % 360;
  const c =
    1.9148 * Math.sin(m * RAD) + 0.02 * Math.sin(2 * m * RAD) + 0.0003 * Math.sin(3 * m * RAD);
  const lambda = (m + c + 180 + 102.9372) % 360;
  const transit = J2000 + jStar + 0.0053 * Math.sin(m * RAD) - 0.0069 * Math.sin(2 * lambda * RAD);
  const sinDec = Math.sin(lambda * RAD) * Math.sin(23.4397 * RAD);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosW =
    (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * sinDec) / (Math.cos(lat * RAD) * cosDec);
  if (cosW < -1 || cosW > 1) return { rise: null, set: null };
  const w = Math.acos(cosW) / RAD;
  return { rise: fromJulian(transit - w / 360), set: fromJulian(transit + w / 360) };
}
