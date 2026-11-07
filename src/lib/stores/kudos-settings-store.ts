"use client";

/**
 * Kudos device-local preferences (Phase 5).
 *
 * Two slots live here because they're per-device, not per-workspace:
 *   - AI features (sentiment / dedup / fairness)         — owner opt-in
 *   - Beacon visibility (ambient / header)               — viewer comfort
 *
 * Version 0 also kept a device-local catalog of custom card themes. The
 * cards are now only the printed Agile at Work ones, so version 1 drops
 * that catalog from what a device kept (saved kudos that carry a custom
 * theme still open, drawn as the "Thank you!" card).
 *
 * Persists to localStorage via the standard zustand persist middleware.
 * Storage is wrapped so Safari Private Browsing / quota-exceeded errors
 * degrade gracefully (in-memory only, no crash) — same pattern as the
 * workspace store.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface KudosSettings {
  aiSentiment: boolean;
  aiDedup: boolean;
  aiFairness: boolean;
  beaconAmbient: boolean;
  beaconHeader: boolean;
}

interface Actions {
  setAiSentiment: (v: boolean) => void;
  setAiDedup: (v: boolean) => void;
  setAiFairness: (v: boolean) => void;
  setBeaconAmbient: (v: boolean) => void;
  setBeaconHeader: (v: boolean) => void;
}

const initial: KudosSettings = {
  aiSentiment: true,
  aiDedup: true,
  aiFairness: true,
  beaconAmbient: true,
  beaconHeader: true,
};

/** What version 0 kept and version 1 no longer does. */
const DROPPED_IN_V1 = ["customThemes"] as const;

export const useKudosSettingsStore = create<KudosSettings & Actions>()(
  persist(
    (set) => ({
      ...initial,
      setAiSentiment: (v) => set({ aiSentiment: v }),
      setAiDedup: (v) => set({ aiDedup: v }),
      setAiFairness: (v) => set({ aiFairness: v }),
      setBeaconAmbient: (v) => set({ beaconAmbient: v }),
      setBeaconHeader: (v) => set({ beaconHeader: v }),
    }),
    {
      name: "agile-toolkit:kudos-settings",
      storage: createJSONStorage(() => {
        if (typeof window === "undefined") {
          return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
        }
        return {
          getItem: (k) => {
            try {
              return localStorage.getItem(k);
            } catch {
              return null;
            }
          },
          setItem: (k, v) => {
            try {
              localStorage.setItem(k, v);
            } catch {
              /* quota / private mode — keep in memory */
            }
          },
          removeItem: (k) => {
            try {
              localStorage.removeItem(k);
            } catch {
              /* swallow */
            }
          },
        };
      }),
      // v1: the custom card themes are gone; a v0 device's catalog is dropped
      // (the default shallow merge would otherwise carry it back into state).
      version: 1,
      migrate: (persisted) => {
        const next: Record<string, unknown> =
          persisted && typeof persisted === "object" ? { ...persisted } : {};
        for (const key of DROPPED_IN_V1) delete next[key];
        return next as unknown as KudosSettings & Actions;
      },
      // Defer the localStorage read so SSR and the first client render both
      // start from `initial` — without this, auto-hydration reads persisted
      // values during store creation on the client while the server rendered
      // defaults, risking a React hydration mismatch for any consumer that
      // reads these on first paint (e.g. a future header beacon). Matches
      // every other persisted store in the app.
      skipHydration: true,
    }
  )
);

if (typeof window !== "undefined") {
  // Kick the deferred rehydrate once on the client so persisted preferences
  // load promptly after first paint. Mirrors the workspace store.
  void Promise.resolve(useKudosSettingsStore.persist.rehydrate()).catch(() => {
    /* corrupt persisted state — keep defaults */
  });
}
