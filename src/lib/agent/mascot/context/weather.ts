/**
 * The weather where the visitor is, as Amr feels it. GET /api/mascot/weather
 * answers from the request's approximate place (Vercel's IP geolocation, rounded
 * to about 11 km), so the browser never asks for the visitor's location; the
 * answer carries no place, only the weather. Nothing is stored beyond this tab.
 *
 * `weatherMoment` turns the reading into one of the weather sheets (S11–S23).
 */

/** What /api/mascot/weather answers (204 when the place isn't known). */
export interface WeatherNow {
  /** WMO weather code (Open-Meteo). */
  code: number;
  /** °C */
  temp: number;
  /** Feels-like, °C */
  feels: number;
  /** km/h */
  wind: number;
  /** km/h */
  gusts: number;
  isDay: boolean;
  /** Dust in the air, µg/m³, or null when unknown. */
  dust: number | null;
  /** Today's sunrise and sunset there, ISO in UTC, or null (polar day or night). */
  sunrise: string | null;
  sunset: string | null;
  /** South of the equator: the seasons are the other way round. */
  south: boolean;
}

export type WeatherMoment =
  | "sun"
  | "heat"
  | "scorch"
  | "cold"
  | "rain"
  | "downpour"
  | "storm"
  | "snow"
  | "wind"
  | "grey"
  | "stars"
  | "dust";

const STORM = new Set([95, 96, 99]);
const SNOW = new Set([71, 73, 75, 77, 85, 86]);
const DOWNPOUR = new Set([65, 67, 81, 82]);
const RAIN = new Set([51, 53, 55, 56, 57, 61, 63, 66, 80]);
const FOG = new Set([45, 48]);

/** Dust (µg/m³) that reads as a khamaseen day. */
export const DUSTY = 150;
/** km/h */
export const WINDY = 35;
export const GUSTY = 55;

/** The weather sheet that fits, most striking first; null for an unremarkable day. */
export function weatherMoment(w: WeatherNow): WeatherMoment | null {
  if (STORM.has(w.code)) return "storm";
  if (SNOW.has(w.code)) return "snow";
  if (DOWNPOUR.has(w.code)) return "downpour";
  if (RAIN.has(w.code)) return "rain";
  if (w.dust !== null && w.dust >= DUSTY) return "dust";
  if (w.wind >= WINDY || w.gusts >= GUSTY) return "wind";
  if (FOG.has(w.code)) return "grey";
  if (w.feels >= 38) return "scorch";
  if (w.feels >= 32) return "heat";
  if (w.feels <= 12) return "cold";
  if (w.code === 3) return "grey";
  if (w.code <= 1) return w.isDay ? "sun" : "stars";
  return null;
}

function isWeatherNow(v: unknown): v is WeatherNow {
  if (!v || typeof v !== "object") return false;
  const w = v as Record<string, unknown>;
  const num = (k: string) => typeof w[k] === "number" && Number.isFinite(w[k]);
  return (
    num("code") &&
    num("temp") &&
    num("feels") &&
    num("wind") &&
    num("gusts") &&
    typeof w.isDay === "boolean" &&
    (w.dust === null || num("dust")) &&
    typeof w.south === "boolean"
  );
}

const CACHE_KEY = "mascot_weather";
const CACHE_MS = 30 * 60_000;

/**
 * The visitor's weather, at most one request per half hour per tab; null when
 * the place isn't known, offline, or anything goes wrong.
 */
export async function fetchVisitorWeather(
  opts: { signal?: AbortSignal; now?: number } = {}
): Promise<WeatherNow | null> {
  const now = opts.now ?? Date.now();
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (raw && raw.length < 4096) {
      const hit = JSON.parse(raw) as { at: number; w: WeatherNow | null };
      if (now - hit.at < CACHE_MS && (hit.w === null || isWeatherNow(hit.w))) return hit.w;
    }
  } catch {
    /* no cache */
  }
  let w: WeatherNow | null = null;
  try {
    const res = await fetch("/api/mascot/weather", { signal: opts.signal });
    if (res.status === 200) {
      const body: unknown = await res.json();
      w = isWeatherNow(body) ? body : null;
    } else if (res.status !== 204) {
      return null; // a server hiccup: ask again next time
    }
  } catch {
    return null;
  }
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: now, w }));
  } catch {
    /* storage unavailable */
  }
  return w;
}
