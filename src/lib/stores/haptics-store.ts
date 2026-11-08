"use client";
import { safeJSONStorage } from "./safe-storage";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { HapticsMode, PerCategoryOverrides } from "@/lib/haptics/types";
import { mergePersisted } from "./persist-migrate";

/** Persisted schema version of `agile-toolkit:haptics`. */
export const HAPTICS_PERSIST_VERSION = 1;

export interface HapticsState {
  enabled: boolean;
  intensity: number; // 0..1
  mode: HapticsMode;
  respectReducedMotion: boolean;
  batteryGuardEnabled: boolean;
  perCategory: PerCategoryOverrides;
  welcomeToastShown: boolean;
  /**
   * Which defaults this payload has been brought up to (1 = Essential, toast
   * and UI haptics off). Marks the v0 → v1 move as done, so a payload that a
   * rolled-back build re-stamped as v0 isn't moved twice.
   */
  defaultsVersion: number;

  setEnabled: (v: boolean) => void;
  setIntensity: (v: number) => void;
  setMode: (m: HapticsMode) => void;
  setRespectReducedMotion: (v: boolean) => void;
  setBatteryGuardEnabled: (v: boolean) => void;
  toggleCategory: (key: keyof PerCategoryOverrides) => void;
  markWelcomeShown: () => void;
  resetToDefaults: () => void;
}

/** The pre-v1 defaults: everything on, Full mode. */
export const HAPTICS_V0_DEFAULTS = {
  enabled: true,
  mode: "full" as HapticsMode,
  perCategory: {
    ceremonies: true,
    voting: true,
    drag: true,
    toasts: true,
    ui: true,
    timer: true,
    error: true,
  } satisfies PerCategoryOverrides,
};

/**
 * v1 defaults: Essential (errors, timer end, milestones), with toast and UI
 * haptics off. A phone no longer buzzes for every tap and success toast.
 */
const DEFAULTS = {
  enabled: true,
  intensity: 0.6,
  mode: "essential" as HapticsMode,
  respectReducedMotion: true,
  batteryGuardEnabled: true,
  perCategory: {
    ceremonies: true,
    voting: true,
    drag: true,
    toasts: false,
    ui: false,
    timer: true,
    error: true,
  } satisfies PerCategoryOverrides,
  welcomeToastShown: false,
  defaultsVersion: 1,
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Bring a stored haptics payload to v1. Idempotent and tolerant: every
 * field is kept, unknown ones too.
 *
 * Someone who never touched the haptics settings (still enabled, Full, every
 * category on) moves to the new defaults: Essential, toast and UI haptics
 * off. Anyone who changed something keeps their choice. Either way the
 * payload is marked `defaultsVersion: 1`, and a marked payload is never moved
 * again: a PR-A build keeps the marker through its pass-through migrate, so a
 * rollback and roll-forward can't undo a user's later choice of Full.
 * Payloads from a newer version pass through untouched.
 */
export function migrateHaptics(persisted: unknown, version: number): HapticsState {
  if (!isPlainObject(persisted)) return {} as HapticsState;
  if (version > HAPTICS_PERSIST_VERSION) return persisted as unknown as HapticsState;
  const p = persisted;
  if (typeof p.defaultsVersion === "number" && p.defaultsVersion >= 1) {
    return p as unknown as HapticsState;
  }
  const cats = isPlainObject(p.perCategory) ? p.perCategory : null;
  const untouched =
    p.enabled !== false &&
    (p.mode === undefined || p.mode === HAPTICS_V0_DEFAULTS.mode) &&
    (cats === null ||
      (Object.keys(HAPTICS_V0_DEFAULTS.perCategory) as (keyof PerCategoryOverrides)[]).every(
        (k) => cats[k] === undefined || cats[k] === true
      ));
  if (!untouched) return { ...p, defaultsVersion: 1 } as unknown as HapticsState;
  return {
    ...p,
    mode: DEFAULTS.mode,
    perCategory: { ...(cats ?? {}), ...DEFAULTS.perCategory },
    defaultsVersion: 1,
  } as unknown as HapticsState;
}

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
      // v1 moves untouched defaults to Essential (migrateHaptics). A payload
      // from a newer build passes through instead of resetting to defaults.
      version: HAPTICS_PERSIST_VERSION,
      migrate: (persisted, version) => migrateHaptics(persisted, version),
      merge: mergePersisted,
    }
  )
);
