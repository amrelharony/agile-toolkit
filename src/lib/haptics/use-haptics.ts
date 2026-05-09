"use client";

import { useCallback } from "react";
import { useHapticsStore } from "@/lib/stores/haptics-store";
import { fire, fireRaw, detectSupport } from "./engine";
import type { HapticPatternName, FireOptions } from "./types";

/**
 * Hook wrapper for the haptics engine.  Returns stable `fire` / `fireRaw`
 * references so consumers can add them to useEffect/useCallback dependency
 * arrays without causing loops.
 */
export function useHaptics() {
  const settings = useHapticsStore();

  const stableFire = useCallback((name: HapticPatternName, opts?: FireOptions) => {
    return fire(name, opts);
  }, []);

  const stableFireRaw = useCallback((vibrate: number[]) => {
    fireRaw(vibrate);
  }, []);

  return {
    fire: stableFire,
    fireRaw: stableFireRaw,
    isSupported: detectSupport() !== "none",
    support: detectSupport(),
    settings,
  };
}
