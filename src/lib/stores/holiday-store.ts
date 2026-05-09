"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
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

export const useHolidayStore = create<HolidayState>()(
  persist(
    (set) => ({
      enabled: true,
      dismissedWindows: {},
      previewThemeId: null,
      setEnabled: (v) => set({ enabled: v }),
      dismiss: (key) =>
        set((s) => ({ dismissedWindows: { ...s.dismissedWindows, [key]: true } })),
      clearDismissed: () => set({ dismissedWindows: {} }),
      setPreview: (id) => set({ previewThemeId: id }),
    }),
    {
      name: "agile-toolkit:holiday",
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
