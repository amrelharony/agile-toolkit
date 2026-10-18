"use client";

/**
 * Isolated, time-travel-enabled, localStorage-persisted store for the
 * Impediment Tracker. Created once at module load so every consumer — the log
 * form, each card, and the main client's workspace bridge — shares the same
 * instance (the bridge relies on `useImpedimentStore.subscribe`/`getState`).
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { withTimeTravel } from "@/lib/stores/with-time-travel";
import { safeJSONStorage } from "@/lib/stores/safe-storage";
import { todayLocalISO } from "@/lib/utils/formatters";
import type { ImpedimentStore } from "./types";

export const useImpedimentStore = create<ImpedimentStore>()(
  persist(
    withTimeTravel<ImpedimentStore>({ toolId: "impediments" }, (set) => ({
      impediments: [],

      addImpediment: (imp) =>
        set((s) => ({
          impediments: [
            {
              ...imp,
              id: crypto.randomUUID(),
              raisedDate: todayLocalISO(),
              status: "Open",
            },
            ...s.impediments,
          ],
        })),

      importImpediment: (imp) =>
        set((s) =>
          s.impediments.some((i) => i.id === imp.id) ? s : { impediments: [imp, ...s.impediments] }
        ),

      updateStatus: (id, status, resolvedDate) =>
        set((s) => ({
          impediments: s.impediments.map((i) =>
            i.id === id
              ? {
                  ...i,
                  status,
                  resolvedDate:
                    status === "Resolved" ? resolvedDate || todayLocalISO() : i.resolvedDate,
                }
              : i
          ),
        })),

      remove: (id) =>
        set((s) => ({
          impediments: s.impediments.filter((i) => i.id !== id),
        })),

      reset: () => set({ impediments: [] }),
    })),
    {
      name: "agile-toolkit:impediments",
      storage: safeJSONStorage("impediments"),
      partialize: (state) => {
        const { _ttPast, _ttFuture, ...rest } = state as ImpedimentStore & {
          _ttPast?: unknown;
          _ttFuture?: unknown;
        };
        void _ttPast;
        void _ttFuture;
        return rest;
      },
    }
  )
);
