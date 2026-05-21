"use client";

import type { WeatherSnapshot } from "./types";
import { getWmoInfo } from "./wmo";

const LATITUDE = 30.0444;
const LONGITUDE = 31.2357;
const TIMEZONE = "Africa/Cairo";
const CACHE_KEY = "agile-toolkit:weather:cairo";
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes — we poll every 60

interface OpenMeteoCurrent {
  time: string;
  temperature_2m: number;
  apparent_temperature: number;
  relative_humidity_2m: number;
  wind_speed_10m: number;
  wind_direction_10m: number;
  weather_code: number;
  is_day: number;
}

interface OpenMeteoResponse {
  current?: OpenMeteoCurrent;
}

interface CacheEntry {
  at: number;
  snapshot: WeatherSnapshot;
}

function readCache(): CacheEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    // Cap the read to a few KB — this slot should never be more than ~1KB
    // and bounding it prevents a corrupted/oversized value from freezing
    // JSON.parse on cold load.
    if (raw.length > 16_384) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    const parsed = JSON.parse(raw) as CacheEntry;
    if (!parsed || typeof parsed !== "object" || typeof parsed.at !== "number") return null;
    if (Date.now() - parsed.at > CACHE_TTL_MS) return null;
    // Validate snapshot shape; a stale persisted entry from a previous
    // schema would otherwise propagate undefined fields to the renderer.
    const snap = parsed.snapshot as Partial<WeatherSnapshot> | undefined;
    if (!snap || typeof snap.temperatureC !== "number" || !Number.isFinite(snap.temperatureC)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(snapshot: WeatherSnapshot) {
  if (typeof window === "undefined") return;
  try {
    const entry: CacheEntry = { at: Date.now(), snapshot };
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    /* quota exceeded — proceed without cache */
  }
}

/**
 * Fetch the current Cairo weather from Open-Meteo.  Returns null on network
 * failure or non-2xx responses so the caller can hide the widget rather than
 * show broken data (per the spec's "graceful fallback" requirement).
 *
 * The API has no rate limit for the free tier on low traffic; we respect it
 * by caching for 30 minutes between actual fetches.
 */
export async function fetchCairoWeather(
  { force = false, signal }: { force?: boolean; signal?: AbortSignal } = {},
): Promise<WeatherSnapshot | null> {
  if (typeof window === "undefined") return null;

  if (!force) {
    const cached = readCache();
    if (cached) return cached.snapshot;
  }

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(LATITUDE));
  url.searchParams.set("longitude", String(LONGITUDE));
  url.searchParams.set(
    "current",
    [
      "temperature_2m",
      "apparent_temperature",
      "relative_humidity_2m",
      "weather_code",
      "wind_speed_10m",
      "wind_direction_10m",
      "is_day",
    ].join(","),
  );
  url.searchParams.set("timezone", TIMEZONE);
  url.searchParams.set("wind_speed_unit", "ms");

  try {
    const response = await fetch(url.toString(), {
      signal,
      // Let the browser cache per its own heuristics but we own the TTL
      // via our localStorage cache — avoids a flurry of requests on HMR.
      cache: "no-store",
    });
    if (!response.ok) return null;
    const body = (await response.json()) as OpenMeteoResponse;
    if (!body.current) return null;

    const c = body.current;
    const snapshot: WeatherSnapshot = {
      observedAt: c.time,
      fetchedAt: Date.now(),
      temperatureC: Number(c.temperature_2m),
      apparentC: Number(c.apparent_temperature),
      humidity: Number(c.relative_humidity_2m),
      windSpeed: Number(c.wind_speed_10m),
      windDirection: Number(c.wind_direction_10m),
      isDay: c.is_day === 1,
      code: Number(c.weather_code),
      info: getWmoInfo(Number(c.weather_code)),
    };
    if (!Number.isFinite(snapshot.temperatureC)) return null;
    writeCache(snapshot);
    return snapshot;
  } catch {
    // Abort, network error, CORS blip, or JSON parse failure — all silent.
    // The widget hides itself rather than showing "—" placeholders.
    return null;
  }
}
