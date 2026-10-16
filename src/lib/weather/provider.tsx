"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { fetchCairoWeather } from "./api";
import { computeStatusBadge } from "./status";
import type { StatusBadge, WeatherSnapshot } from "./types";
import { setWeatherMood } from "@/lib/emotion/engine";

/** 60-minute refresh cadence per the spec. */
const POLL_INTERVAL_MS = 60 * 60 * 1000;
/** Re-compute the status badge every minute so hour-boundary crossings land on time. */
const BADGE_TICK_MS = 60 * 1000;

interface WeatherContextValue {
  weather: WeatherSnapshot | null;
  badge: StatusBadge;
  /** True if the most recent fetch failed — widget stays hidden when true. */
  failed: boolean;
  /** Force a fresh fetch (used by the widget's refresh affordance). */
  refresh: () => Promise<void>;
}

const WeatherContext = createContext<WeatherContextValue | null>(null);

/**
 * The weather is the site owner's (Cairo) — personal flavour for the header,
 * the mascot's particles and the emotion/holiday engines. `enabled={false}`
 * (visitors) skips the network entirely and leaves `weather` null, so every
 * consumer falls back to its no-weather behaviour.
 */
export function WeatherProvider({
  children,
  enabled = true,
}: {
  children: React.ReactNode;
  enabled?: boolean;
}) {
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [badge, setBadge] = useState<StatusBadge>(() => computeStatusBadge(new Date(), null));
  const abortRef = useRef<AbortController | null>(null);
  // A ref mirror of `weather` lets the visibility handler read the latest
  // snapshot without re-attaching the listener on every fetch.
  const weatherRef = useRef<WeatherSnapshot | null>(null);
  useEffect(() => {
    weatherRef.current = weather;
  }, [weather]);

  const fetchNow = useCallback(async (force = false) => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    let snapshot: WeatherSnapshot | null = null;
    try {
      snapshot = await fetchCairoWeather({ force, signal: controller.signal });
    } catch (err) {
      // fetchCairoWeather already returns null on most failures, but a thrown
      // network/abort error would otherwise bubble up as an unhandled promise
      // rejection AND leave `failed` stale → widget keeps showing old data.
      if ((err as { name?: string })?.name === "AbortError") return;
      snapshot = null;
    }
    if (controller.signal.aborted) return;

    if (snapshot) {
      setWeather(snapshot);
      setFailed(false);
      setBadge(computeStatusBadge(new Date(), snapshot));
      // Feed the weather-derived mood into the Emotion Engine (spec's hidden
      // logic).  Engine itself gates on user's useWeatherFallback toggle.
      setWeatherMood(snapshot.info.mood);
    } else {
      setWeather(null);
      setFailed(true);
      setBadge(computeStatusBadge(new Date(), null));
    }
  }, []);

  // Initial fetch + 60-minute poll
  useEffect(() => {
    if (!enabled) return;
    void fetchNow();
    const id = window.setInterval(() => {
      void fetchNow(true);
    }, POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(id);
      abortRef.current?.abort();
    };
  }, [fetchNow, enabled]);

  // Per-minute badge tick so hour boundaries land promptly
  useEffect(() => {
    const id = window.setInterval(() => {
      setBadge(computeStatusBadge(new Date(), weatherRef.current));
    }, BADGE_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  // Re-fetch when the tab becomes visible after a long hidden period.
  // Reads weatherRef so we don't re-attach the listener on every snapshot.
  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      const last = weatherRef.current?.fetchedAt ?? 0;
      if (Date.now() - last > 30 * 60 * 1000) void fetchNow(true);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [fetchNow, enabled]);

  const value = useMemo<WeatherContextValue>(
    () => ({
      weather,
      badge,
      failed,
      refresh: () => fetchNow(true),
    }),
    [weather, badge, failed, fetchNow]
  );

  return <WeatherContext.Provider value={value}>{children}</WeatherContext.Provider>;
}

export function useWeather(): WeatherContextValue {
  const ctx = useContext(WeatherContext);
  if (!ctx) {
    return {
      weather: null,
      badge: computeStatusBadge(new Date(), null),
      failed: false,
      refresh: async () => {},
    };
  }
  return ctx;
}
