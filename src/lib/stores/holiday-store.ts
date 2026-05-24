"use client";
import { safeJSONStorage } from "./safe-storage";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { HolidayId } from "@/lib/holiday/types";

interface HolidayState {
  enabled: boolean;
  /** Keyed by `${holidayId}::${startISO}` so dismissals are per-window. */
  dismissedWindows: Record<string, boolean>;
  /** Dev override: preview a specific theme by id regardless of date. */
  previewThemeId: HolidayId | null;

  setEnabled: (v: boolean) => void;
  dismiss: (windowKey: string) => void;
  clearDismissed: () => void;
  setPreview: (id: HolidayId | null) => void;
}

// Strict allowlist: id+ISO date. Anything else is rejected so a stray caller
// can't poison the dismissedWindows record with arbitrary keys (which would
// otherwise be a stored-XSS vector if those keys were ever rendered as HTML).
const WINDOW_KEY_RE = /^[a-z0-9-]{1,40}::\d{4}-\d{2}-\d{2}$/i;

/** Drop dismissed entries whose start date is older than ~18 months. Without
 *  pruning, the record grows unbounded across years of dismissals. */
function pruneStale(record: Record<string, boolean>): Record<string, boolean> {
  const cutoff = Date.now() - 18 * 30 * 24 * 60 * 60 * 1000;
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(record)) {
    const datePart = k.split("::")[1];
    if (!datePart) continue;
    const t = Date.parse(datePart);
    if (!Number.isFinite(t) || t < cutoff) continue;
    out[k] = v;
  }
  return out;
}

export const useHolidayStore = create<HolidayState>()(
  persist(
    (set) => ({
      enabled: true,
      dismissedWindows: {},
      previewThemeId: null,
      setEnabled: (v) => set({ enabled: v }),
      dismiss: (key) =>
        set((s) => {
          // Reject anything that doesn't match the expected `id::yyyy-mm-dd`
          // shape — a typo or malicious caller can't grow this record into
          // a runtime XSS sink.
          if (!WINDOW_KEY_RE.test(key)) return s;
          return { dismissedWindows: { ...s.dismissedWindows, [key]: true } };
        }),
      clearDismissed: () => set({ dismissedWindows: {} }),
      setPreview: (id) => set({ previewThemeId: id }),
    }),
    {
      name: "agile-toolkit:holiday",
      storage: safeJSONStorage("holiday"),
      skipHydration: true,
      // Prune stale entries every time we rehydrate from disk — cheap, runs
      // once per app load, keeps storage bounded across years of usage.
      onRehydrateStorage: () => (state) => {
        if (state && state.dismissedWindows) {
          state.dismissedWindows = pruneStale(state.dismissedWindows);
        }
      },
    }
  )
);
