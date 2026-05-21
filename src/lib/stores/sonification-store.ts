"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { SonificationMode, SonificationPrefs } from "../sonification/types";

interface Actions {
  setEnabled: (v: boolean) => void;
  toggleEnabled: () => void;
  setMasterVolume: (v: number) => void;
  setMode: (m: SonificationMode) => void;
  setRespectReducedMotion: (v: boolean) => void;
  setLastAutoplayError: (msg: string | undefined) => void;
}

const initial: SonificationPrefs = {
  enabled: false,
  masterVolume: 0.4,
  mode: "full",
  respectReducedMotion: true,
  lastAutoplayError: undefined,
};

export const useSonificationStore = create<SonificationPrefs & Actions>()(
  persist(
    (set) => ({
      ...initial,
      setEnabled: (v) => set({ enabled: v }),
      toggleEnabled: () => set((s) => ({ enabled: !s.enabled })),
      setMasterVolume: (v) =>
        // Guard against NaN — `Math.max/min` propagate NaN as-is, which
        // would persist `null` (via JSON.stringify) and surface as a muted
        // audio engine on next load with no obvious cause.
        set({
          masterVolume: Number.isFinite(v)
            ? Math.max(0, Math.min(1, v))
            : initial.masterVolume,
        }),
      setMode: (m) => set({ mode: m }),
      setRespectReducedMotion: (v) => set({ respectReducedMotion: v }),
      setLastAutoplayError: (msg) => set({ lastAutoplayError: msg }),
    }),
    {
      name: "agile-toolkit:sonification",
      // Exclude the transient autoplay-error message from persistence — it's
      // a debug breadcrumb tied to the current session, not state we want to
      // re-show across reloads.
      partialize: (s) => ({
        enabled: s.enabled,
        masterVolume: s.masterVolume,
        mode: s.mode,
        respectReducedMotion: s.respectReducedMotion,
        // lastAutoplayError intentionally omitted
      }),
      storage: createJSONStorage(() => {
        if (typeof window !== "undefined") return localStorage;
        return {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
        };
      }),
      skipHydration: true,
    }
  )
);
