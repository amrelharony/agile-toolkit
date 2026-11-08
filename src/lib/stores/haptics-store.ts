"use client";
import { safeJSONStorage } from "./safe-storage";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { HapticsMode, PerCategoryOverrides } from "@/lib/haptics/types";
import { passThroughMigrate } from "./persist-migrate";

/** Persisted schema version of `agile-toolkit:haptics`. */
export const HAPTICS_PERSIST_VERSION = 0;

export interface HapticsState {
  enabled: boolean;
  intensity: number; // 0..1
  mode: HapticsMode;
  respectReducedMotion: boolean;
  batteryGuardEnabled: boolean;
  perCategory: PerCategoryOverrides;
  welcomeToastShown: boolean;

  setEnabled: (v: boolean) => void;
  setIntensity: (v: number) => void;
  setMode: (m: HapticsMode) => void;
  setRespectReducedMotion: (v: boolean) => void;
  setBatteryGuardEnabled: (v: boolean) => void;
  toggleCategory: (key: keyof PerCategoryOverrides) => void;
  markWelcomeShown: () => void;
  resetToDefaults: () => void;
}

const DEFAULTS = {
  enabled: true,
  intensity: 0.6,
  mode: "full" as HapticsMode,
  respectReducedMotion: true,
  batteryGuardEnabled: true,
  perCategory: {
    ceremonies: true,
    voting: true,
    drag: true,
    toasts: true,
    ui: true,
    timer: true,
    error: true,
  } satisfies PerCategoryOverrides,
  welcomeToastShown: false,
};

export const useHapticsStore = create<HapticsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setEnabled: (v) => set({ enabled: v }),
      setIntensity: (v) =>
        // `Math.max(0, Math.min(1, NaN))` returns NaN, which JSON.stringifies
        // as `null` and breaks the haptics engine on rehydrate. Coerce NaN
        // to the default before clamping.
        set({
          intensity: Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : DEFAULTS.intensity,
        }),
      setMode: (m) => set({ mode: m }),
      setRespectReducedMotion: (v) => set({ respectReducedMotion: v }),
      setBatteryGuardEnabled: (v) => set({ batteryGuardEnabled: v }),
      toggleCategory: (key) =>
        set((s) => ({
          perCategory: { ...s.perCategory, [key]: !s.perCategory[key] },
        })),
      markWelcomeShown: () => set({ welcomeToastShown: true }),
      resetToDefaults: () => set({ ...DEFAULTS }),
    }),
    {
      name: "agile-toolkit:haptics",
      storage: safeJSONStorage("haptics"),
      skipHydration: true,
      // Rollback safety: keep a payload written by a newer build instead of
      // resetting to defaults (see vdna-store).
      version: HAPTICS_PERSIST_VERSION,
      migrate: passThroughMigrate,
    }
  )
);
