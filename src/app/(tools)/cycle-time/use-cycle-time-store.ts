"use client";

/**
 * Isolated localStorage-persisted store for the Cycle Time Analyzer. Created
 * once at module load so every consumer shares the same instance. Seeds a
 * single hydration-safe default item (deterministic id) so SSR matches the
 * client on first paint.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { safeJSONStorage } from "@/lib/stores/safe-storage";
import type { CycleTimeStore, WorkItem } from "./types";

const createItem = (): WorkItem => ({
  id: crypto.randomUUID(),
  name: "",
  startDate: "",
  endDate: "",
  // description omitted intentionally — optional, lazy-initialized.
});

/** Hydration-safe default — see same pattern in capacity-planner. */
const defaultFirstItem: WorkItem = {
  id: "default:item-1",
  name: "",
  startDate: "",
  endDate: "",
};

export const useCycleTimeStore = create<CycleTimeStore>()(
  persist(
    (set) => ({
      items: [defaultFirstItem],

      addItem: () => set((s) => ({ items: [...s.items, createItem()] })),

      removeItem: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),

      updateItem: (id, updates) =>
        set((s) => ({
          items: s.items.map((i) => (i.id === id ? { ...i, ...updates } : i)),
        })),

      reset: () => set({ items: [createItem()] }),
    }),
    { name: "agile-toolkit:cycle-time", storage: safeJSONStorage("cycle-time") }
  )
);
