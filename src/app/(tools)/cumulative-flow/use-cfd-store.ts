"use client";

/**
 * Isolated localStorage-persisted store for the Cumulative Flow Diagram.
 * Created once at module load so every consumer shares the same instance.
 * Column rename rejects case-insensitive duplicates (Recharts keys Areas by
 * column name) and addEntry dedupes same-day snapshots atomically inside the
 * reducer.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { safeJSONStorage } from "@/lib/stores/safe-storage";
import type { CFDStore, StatusColumn } from "./types";
import { DEFAULT_COLORS, DEFAULT_COLUMNS, createEntry } from "./constants";

export const useCFDStore = create<CFDStore>()(
  persist(
    (set) => ({
      columns: DEFAULT_COLUMNS,
      entries: [],
      wipLimit: null,

      addColumn: (name, description) =>
        set((s) => {
          const id = crypto.randomUUID();
          const color = DEFAULT_COLORS[s.columns.length % DEFAULT_COLORS.length];
          const newCol: StatusColumn = { id, name, color, description };
          return {
            columns: [...s.columns, newCol],
            entries: s.entries.map((e) => ({
              ...e,
              counts: { ...e.counts, [id]: 0 },
            })),
          };
        }),

      removeColumn: (id) =>
        set((s) => ({
          columns: s.columns.filter((c) => c.id !== id),
          entries: s.entries.map((e) => {
            const counts = { ...e.counts };
            delete counts[id];
            return { ...e, counts };
          }),
        })),

      renameColumn: (id, name) =>
        set((s) => {
          // Reject rename to a name that already exists on another
          // column. Recharts uses the column name as the chart
          // `dataKey`, and two Area series sharing the same dataKey
          // collapse to one, silently hiding the renamed column's data.
          // The add-form rejects duplicate names; rename used to allow them.
          // BUG-RD3-cfd-1: case-INSENSITIVE collide check so the rename
          // path matches the add path (which uses .toLowerCase()
          // equality). Without this, "To Do" → "TO DO" was accepted
          // and produced two visually-identical column headers with
          // distinct Recharts dataKeys — confusing the user but not
          // technically colliding.
          const trimmed = name.trim();
          if (trimmed.length === 0) return s;
          const want = trimmed.toLowerCase();
          const collides = s.columns.some((c) => c.id !== id && c.name.toLowerCase() === want);
          if (collides) return s;
          return {
            columns: s.columns.map((c) => (c.id === id ? { ...c, name: trimmed } : c)),
          };
        }),

      setColumnDescription: (id, description) =>
        set((s) => ({
          columns: s.columns.map((c) => (c.id === id ? { ...c, description } : c)),
        })),

      addEntry: () =>
        set((s) => {
          // R11-fix: move the duplicate-check INSIDE the set updater
          // so read + write are atomic. Previously the same-day guard
          // lived in the client wrapper (a getState read followed by
          // an addEntryRaw write) — a double-click could fire both
          // calls before either's getState saw the other's append,
          // bypassing the dedupe and creating two snapshots for the
          // same day. Now the check happens inside Zustand's reducer
          // where state.entries is the live array at write-time.
          const today = createEntry(s.columns);
          if (s.entries.some((e) => e.date === today.date)) return s;
          return { entries: [...s.entries, today] };
        }),

      removeEntry: (id) => set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),

      updateEntry: (id, updates) =>
        set((s) => ({
          entries: s.entries.map((e) => (e.id === id ? { ...e, ...updates } : e)),
        })),

      updateEntryCount: (entryId, statusId, count) =>
        set((s) => ({
          entries: s.entries.map((e) =>
            e.id === entryId ? { ...e, counts: { ...e.counts, [statusId]: Math.max(0, count) } } : e
          ),
        })),

      setWipLimit: (limit) => set({ wipLimit: limit }),

      reset: () => set({ columns: DEFAULT_COLUMNS, entries: [], wipLimit: null }),
    }),
    { name: "agile-toolkit:cumulative-flow", storage: safeJSONStorage("cumulative-flow") }
  )
);
