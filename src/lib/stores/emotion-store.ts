"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Mood } from "@/lib/emotion/types";

export interface EmotionState {
  /** Master toggle. When false, the engine always resolves to "Neutral". */
  enabled: boolean;
  /** Explicit user-pinned mood — bypasses all other sources. */
  userOverride: Mood | null;
  /** Whether to allow weather to influence mood (privacy/UX toggle). */
  useWeatherFallback: boolean;
  /** Whether to allow time-of-day to nudge mood. */
  useTimeSignal: boolean;
  /** Whether to gate animation intensity with prefers-reduced-motion. */
  respectReducedMotion: boolean;

  setEnabled: (v: boolean) => void;
  setUserOverride: (mood: Mood | null) => void;
  setUseWeatherFallback: (v: boolean) => void;
  setUseTimeSignal: (v: boolean) => void;
  setRespectReducedMotion: (v: boolean) => void;
  resetToDefaults: () => void;
}

const DEFAULTS = {
  enabled: true,
  userOverride: null as Mood | null,
  useWeatherFallback: true,
  useTimeSignal: true,
  respectReducedMotion: true,
};

export const useEmotionStore = create<EmotionState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setEnabled: (v) => set({ enabled: v }),
      setUserOverride: (mood) => set({ userOverride: mood }),
      setUseWeatherFallback: (v) => set({ useWeatherFallback: v }),
      setUseTimeSignal: (v) => set({ useTimeSignal: v }),
      setRespectReducedMotion: (v) => set({ respectReducedMotion: v }),
      resetToDefaults: () => set({ ...DEFAULTS }),
    }),
    {
      name: "agile-toolkit:emotion",
      storage: createJSONStorage(() => {
        if (typeof window !== "undefined") return localStorage;
        return {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
        };
      }),
      skipHydration: true,
    },
  ),
);
