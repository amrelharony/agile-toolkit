"use client";

/**
 * Kudos device-local preferences (Phase 5).
 *
 * Three slots live here because they're per-device, not per-workspace:
 *   - AI features (sentiment / dedup / fairness)         — owner opt-in
 *   - Beacon visibility (ambient / header)               — viewer comfort
 *   - Custom themes                                       — extends the catalog
 *
 * Custom themes are workspace-shared via the Kudos row's `theme` field
 * (Phase 0 widened `KudosTheme` to accept the inline object), but the
 * CATALOG of themes the owner can choose from in the form / settings
 * lives device-local. Sharing the catalog across devices means re-
 * extending the workspace store; the plan calls that out as a separate
 * decision to be wired in by the parent. For now: device-local, opt-in
 * to settings UI = opt-in to broadcasting custom themes attached to
 * outgoing kudos.
 *
 * Persists to localStorage via the standard zustand persist middleware.
 * Storage is wrapped so Safari Private Browsing / quota-exceeded errors
 * degrade gracefully (in-memory only, no crash) — same pattern as the
 * workspace store.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { KudosCustomTheme } from "./workspace-types";

export interface KudosSettings {
  aiSentiment: boolean;
  aiDedup: boolean;
  aiFairness: boolean;
  beaconAmbient: boolean;
  beaconHeader: boolean;
  customThemes: KudosCustomTheme[];
}

interface Actions {
  setAiSentiment: (v: boolean) => void;
  setAiDedup: (v: boolean) => void;
  setAiFairness: (v: boolean) => void;
  setBeaconAmbient: (v: boolean) => void;
  setBeaconHeader: (v: boolean) => void;
  upsertCustomTheme: (t: KudosCustomTheme) => void;
  removeCustomTheme: (id: string) => void;
}

const initial: KudosSettings = {
  aiSentiment: true,
  aiDedup: true,
  aiFairness: true,
  beaconAmbient: true,
  beaconHeader: true,
  customThemes: [],
};

export const useKudosSettingsStore = create<KudosSettings & Actions>()(
  persist(
    (set) => ({
      ...initial,
      setAiSentiment: (v) => set({ aiSentiment: v }),
      setAiDedup: (v) => set({ aiDedup: v }),
      setAiFairness: (v) => set({ aiFairness: v }),
      setBeaconAmbient: (v) => set({ beaconAmbient: v }),
      setBeaconHeader: (v) => set({ beaconHeader: v }),
      upsertCustomTheme: (t) =>
        set((s) => {
          const idx = s.customThemes.findIndex((x) => x.id === t.id);
          if (idx === -1) return { customThemes: [...s.customThemes, t] };
          const next = s.customThemes.slice();
          next[idx] = t;
          return { customThemes: next };
        }),
      removeCustomTheme: (id) =>
        set((s) => ({ customThemes: s.customThemes.filter((t) => t.id !== id) })),
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
    }
  )
);
