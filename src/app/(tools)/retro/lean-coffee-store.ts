"use client";

/**
 * The Lean Coffee runner's timeboxes, kept in this browser
 * (`agile-toolkit:retro-lean-coffee`): the first timebox for a topic and
 * each "keep going". Read through `minutesIn`, so a synced or hand-edited
 * value falls back to 7 and 3.
 */

import { useEffect } from "react";
import { createPersistedStore } from "@/lib/stores/create-persisted-store";
import {
  LEAN_COFFEE_EXTEND_CHOICES,
  LEAN_COFFEE_EXTEND_MIN,
  LEAN_COFFEE_TIMEBOX_CHOICES,
  LEAN_COFFEE_TIMEBOX_MIN,
  minutesIn,
} from "@/lib/retro/lean-coffee";

export interface LeanCoffeeSettings {
  timeboxMin: number;
  extendMin: number;
}

export const useLeanCoffeeStore = createPersistedStore<LeanCoffeeSettings>("retro-lean-coffee", {
  timeboxMin: LEAN_COFFEE_TIMEBOX_MIN,
  extendMin: LEAN_COFFEE_EXTEND_MIN,
});

/** The timeboxes, clean, with setters. */
export function useLeanCoffeeSettings(): LeanCoffeeSettings & {
  setTimebox: (min: number) => void;
  setExtend: (min: number) => void;
} {
  useEffect(() => {
    const { persist } = useLeanCoffeeStore;
    void Promise.resolve(persist.hasHydrated() ? undefined : persist.rehydrate()).catch(() => {
      /* storage blocked: the defaults hold */
    });
  }, []);
  const timeboxMin = minutesIn(
    useLeanCoffeeStore((s) => s.timeboxMin),
    LEAN_COFFEE_TIMEBOX_CHOICES,
    LEAN_COFFEE_TIMEBOX_MIN
  );
  const extendMin = minutesIn(
    useLeanCoffeeStore((s) => s.extendMin),
    LEAN_COFFEE_EXTEND_CHOICES,
    LEAN_COFFEE_EXTEND_MIN
  );
  return {
    timeboxMin,
    extendMin,
    setTimebox: (min) => useLeanCoffeeStore.setState({ timeboxMin: min }),
    setExtend: (min) => useLeanCoffeeStore.setState({ extendMin: min }),
  };
}
