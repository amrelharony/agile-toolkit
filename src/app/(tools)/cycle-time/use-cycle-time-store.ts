"use client";

/**
 * Device-local store for the Cycle Time Analyzer's typed items: the
 * fallback for work tracked outside the toolkit. Finished stories and
 * Flow-board cards are read live from the workspace (lib/flow), never
 * copied here. Created once at module load so every consumer shares the
 * same instance.
 *
 * Starts empty. Earlier versions seeded a blank row (`default:item-1`)
 * and "Add Item" saved another; the version-1 migration drops every row
 * with no name and no dates, and keeps anything the user typed.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { safeJSONStorage } from "@/lib/stores/safe-storage";
import { SLE_PERCENTILES, type CycleTimeStore, type SlePercentile, type WorkItem } from "./types";

/** A row nobody filled in: no name and no dates. */
export const isBlankItem = (i: Pick<WorkItem, "name" | "startDate" | "endDate">): boolean =>
  !String(i.name ?? "").trim() &&
  !String(i.startDate ?? "").trim() &&
  !String(i.endDate ?? "").trim();

/**
 * Stored state from any earlier version, made safe to read: blank rows
 * dropped, rows that aren't rows skipped, the settings defaulted. Never
 * throws, and running it twice changes nothing.
 */
export function migrateCycleTimeState(
  stored: unknown
): Pick<CycleTimeStore, "items" | "targetPct" | "sleTargetDays"> {
  const s = (typeof stored === "object" && stored !== null ? stored : {}) as Record<
    string,
    unknown
  >;
  const items = Array.isArray(s.items)
    ? (s.items as unknown[])
        .filter(
          (i): i is WorkItem =>
            typeof i === "object" && i !== null && typeof (i as WorkItem).id === "string"
        )
        .map((i) => ({
          ...i,
          name: typeof i.name === "string" ? i.name : "",
          startDate: typeof i.startDate === "string" ? i.startDate : "",
          endDate: typeof i.endDate === "string" ? i.endDate : "",
        }))
        .filter((i) => !isBlankItem(i))
    : [];
  const targetPct = SLE_PERCENTILES.includes(s.targetPct as SlePercentile)
    ? (s.targetPct as SlePercentile)
    : 85;
  const days = s.sleTargetDays;
  const sleTargetDays =
    typeof days === "number" && Number.isInteger(days) && days > 0 ? days : null;
  return { items, targetPct, sleTargetDays };
}

export const useCycleTimeStore = create<CycleTimeStore>()(
  persist(
    (set) => ({
      items: [],
      targetPct: 85,
      sleTargetDays: null,

      addItem: (values) => {
        const item: WorkItem = { ...values, id: crypto.randomUUID() };
        set((s) => ({ items: [...s.items, item] }));
        return item;
      },

      removeItem: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),

      updateItem: (id, updates) =>
        set((s) => ({
          items: s.items.map((i) => (i.id === id ? { ...i, ...updates } : i)),
        })),

      setTargetPct: (targetPct) => set({ targetPct }),

      setSleTargetDays: (days) =>
        set({ sleTargetDays: days !== null && Number.isInteger(days) && days > 0 ? days : null }),

      reset: () => set({ items: [] }),

      restoreItems: (items) => set({ items }),
    }),
    {
      name: "agile-toolkit:cycle-time",
      storage: safeJSONStorage("cycle-time"),
      version: 1,
      migrate: (stored) => migrateCycleTimeState(stored) as unknown as CycleTimeStore,
      merge: (persisted, current) => ({ ...current, ...migrateCycleTimeState(persisted) }),
      partialize: (s) => ({
        items: s.items,
        targetPct: s.targetPct,
        sleTargetDays: s.sleTargetDays,
      }),
    }
  )
);
