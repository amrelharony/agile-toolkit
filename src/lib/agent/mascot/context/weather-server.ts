/**
 * Server side of /api/mascot/weather: where the request comes from, roughly,
 * and the weather there from Open-Meteo (free, no key; the toolkit's Cairo
 * widget already uses it). The place comes from the geolocation headers Vercel
 * adds to every request, rounded to a tenth of a degree (about 11 km) before it
 * leaves the server, so a whole area shares one cached answer. It isn't logged,
 * stored or sent back.
 */

import type { WeatherNow } from "./weather";

export interface Place {
  lat: number;
  lon: number;
}

/** A tenth of a degree: about 11 km, a town, never a street. */
export const round1 = (x: number) => Math.round(x * 10) / 10;

function parsePlace(lat: string | null, lon: string | null): Place | null {
  if (!lat || !lon) return null;
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  if (Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
  return { lat: round1(la), lon: round1(lo) };
}

/**
 * The request's rough place: Vercel's IP geolocation, or, off production, an
 * `?at=lat,lon` for trying a place out.
 */
export function placeFrom(
  headers: Headers,
  search: URLSearchParams,
  allowOverride: boolean
): Place | null {
  if (allowOverride) {
    const at = search.get("at");
    if (at) {
      const [lat, lon] = at.split(",");
      const p = parsePlace(lat ?? null, lon ?? null);
      if (p) return p;
    }
  }
  return parsePlace(headers.get("x-vercel-ip-latitude"), headers.get("x-vercel-ip-longitude"));
}

/** How long one area's answer is reused, on the server and in the browser. */
export const WEATHER_TTL_S = 900;
/** Open-Meteo is usually quick, but can take several seconds; Amr never waits on it. */
const TIMEOUT_MS = 8000;

type Fetcher = (
  url: string,
  init?: RequestInit & { next?: { revalidate?: number } }
) => Promise<Response>;

interface ForecastBody {
  utc_offset_seconds?: number;
  current?: {
    temperature_2m?: number;
    apparent_temperature?: number;
    weather_code?: number;
    is_day?: number;
    wind_speed_10m?: number;
    wind_gusts_10m?: number;
  };
  daily?: { sunrise?: string[]; sunset?: string[] };
}

/** Open-Meteo's local "YYYY-MM-DDTHH:MM" plus the place's offset → ISO in UTC. */
export function localToUtcIso(local: string | undefined, offsetS: number): string | null {
  const m = local?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - offsetS * 1000).toISOString();
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

async function getJson(fetcher: Fetcher, url: string): Promise<unknown> {
  const res = await fetcher(url, {
    next: { revalidate: WEATHER_TTL_S },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  return res.json();
}

/** The weather at a place, or null if Open-Meteo can't say. */
export async function readWeather(
  place: Place,
  fetcher: Fetcher = fetch
): Promise<WeatherNow | null> {
  const where = `latitude=${place.lat}&longitude=${place.lon}`;
  const forecastUrl =
    `https://api.open-meteo.com/v1/forecast?${where}` +
    "&current=temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,wind_gusts_10m" +
    "&daily=sunrise,sunset&timezone=auto&forecast_days=1";
  const airUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?${where}&current=dust`;

  const [forecast, air] = await Promise.allSettled([
    getJson(fetcher, forecastUrl),
    getJson(fetcher, airUrl),
  ]);
  if (forecast.status !== "fulfilled") return null;
  const body = forecast.value as ForecastBody;
  const c = body.current ?? {};
  const code = num(c.weather_code);
  const temp = num(c.temperature_2m);
  if (code === null || temp === null) return null;
  const offset = num(body.utc_offset_seconds) ?? 0;
  const dust =
    air.status === "fulfilled"
      ? num((air.value as { current?: { dust?: unknown } })?.current?.dust)
      : null;

  return {
    code,
    temp,
    feels: num(c.apparent_temperature) ?? temp,
    wind: num(c.wind_speed_10m) ?? 0,
    gusts: num(c.wind_gusts_10m) ?? 0,
    isDay: c.is_day === 1,
    dust,
    sunrise: localToUtcIso(body.daily?.sunrise?.[0], offset),
    sunset: localToUtcIso(body.daily?.sunset?.[0], offset),
    south: place.lat < 0,
  };
}
