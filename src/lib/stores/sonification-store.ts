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
        set({ masterVolume: Math.max(0, Math.min(1, v)) }),
      setMode: (m) => set({ mode: m }),
      setRespectReducedMotion: (v) => set({ respectReducedMotion: v }),
      setLastAutoplayError: (msg) => set({ lastAutoplayError: msg }),
    }),
    {
      name: "agile-toolkit:sonification",
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
