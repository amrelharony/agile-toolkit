"use client";

/**
 * Device-local store for the Cumulative Flow Diagram's typed snapshots:
 * the fallback for a team that tracks its board somewhere the toolkit
 * can't read. The Sprint and Flow boards are read live from the workspace
 * (lib/flow), never copied here. Created once at module load so every
 * consumer shares the same instance.
 *
 * Writes are validated: one snapshot per date (on add and on a date edit,
 * checked inside the reducer so a double click can't slip past), counts
 * only as whole numbers from 0, and a new column goes before Done so the
 * last column stays the done one.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { safeJSONStorage } from "@/lib/stores/safe-storage";
import type { CFDStore, CfdSource, DataEntry, StatusColumn, TypedSnapshotState } from "./types";
import { DEFAULT_COLUMNS, MAX_COUNT } from "./constants";

const isCount = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= MAX_COUNT;

/** A count as older versions may have stored it (they took any number typed). */
const isStoredCount = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0;

const SOURCES: readonly CfdSource[] = ["sprint", "flow", "typed"];

/**
 * Stored state from any earlier version, made safe to read: lists that
 * aren't lists become empty, counts that aren't counts are dropped (they
 * read as 0 on the chart), and the old zero-filled snapshots load as they
 * are. Never throws, so a bad blob can't blank the page.
 */
export function migrateCfdState(
  stored: unknown
): TypedSnapshotState & { source: CfdSource | null } {
  const s = (typeof stored === "object" && stored !== null ? stored : {}) as Record<
    string,
    unknown
  >;
  const columns = Array.isArray(s.columns)
    ? (s.columns as unknown[]).filter(
        (c): c is StatusColumn =>
          typeof c === "object" &&
          c !== null &&
          typeof (c as StatusColumn).id === "string" &&
          typeof (c as StatusColumn).name === "string"
      )
    : DEFAULT_COLUMNS;
  const entries = Array.isArray(s.entries)
    ? (s.entries as unknown[])
        .filter(
          (e): e is DataEntry =>
            typeof e === "object" &&
            e !== null &&
            typeof (e as DataEntry).id === "string" &&
            typeof (e as DataEntry).date === "string"
        )
        .map((e) => ({
          ...e,
          counts: Object.fromEntries(
            Object.entries(typeof e.counts === "object" && e.counts ? e.counts : {}).filter(
              ([, v]) => isStoredCount(v)
            )
          ),
        }))
    : [];
  const wipLimit = isStoredCount(s.wipLimit) && s.wipLimit > 0 ? s.wipLimit : null;
  const source = SOURCES.includes(s.source as CfdSource) ? (s.source as CfdSource) : null;
  return { columns: columns.length > 0 ? columns : DEFAULT_COLUMNS, entries, wipLimit, source };
}

export const useCFDStore = create<CFDStore>()(
  persist(
    (set, get) => ({
      columns: DEFAULT_COLUMNS,
      entries: [],
      wipLimit: null,
      source: null,

      setSource: (source) => set({ source }),

      addColumn: (name, description) =>
        set((s) => {
          const column: StatusColumn = { id: crypto.randomUUID(), name, description };
          // Before the last column: appended, a new "Blocked" became Done.
          const at = Math.max(0, s.columns.length - 1);
          return { columns: [...s.columns.slice(0, at), column, ...s.columns.slice(at)] };
        }),

      removeColumn: (id) =>
        set((s) => ({
          columns: s.columns.filter((c) => c.id !== id),
          entries: s.entries.map((e) => {
            if (!(id in e.counts)) return e;
            const counts = { ...e.counts };
            delete counts[id];
            return { ...e, counts };
          }),
        })),

      restoreColumn: (column, index, counts) =>
        set((s) => {
          if (s.columns.some((c) => c.id === column.id)) return s;
          const at = Math.max(0, Math.min(index, s.columns.length));
          return {
            columns: [...s.columns.slice(0, at), column, ...s.columns.slice(at)],
            entries: s.entries.map((e) =>
              isCount(counts[e.id])
                ? { ...e, counts: { ...e.counts, [column.id]: counts[e.id] } }
                : e
            ),
          };
        }),

      renameColumn: (id, name) =>
        set((s) => {
          // Case-insensitive, like the add form: "To Do" and "TO DO" would be
          // two columns no one can tell apart.
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

      addEntry: (entry) => {
        // Checked against the live list inside the write, so a double click
        // can't add two snapshots for one date.
        if (get().entries.some((e) => e.date === entry.date)) return false;
        const counts = Object.fromEntries(
          Object.entries(entry.counts).filter(([, v]) => isCount(v))
        );
        set((s) => ({ entries: [...s.entries, { ...entry, counts, id: crypto.randomUUID() }] }));
        return true;
      },

      updateEntry: (id, updates) => {
        if (
          updates.date !== undefined &&
          get().entries.some((e) => e.id !== id && e.date === updates.date)
        ) {
          return false;
        }
        set((s) => ({
          entries: s.entries.map((e) => (e.id === id ? { ...e, ...updates } : e)),
        }));
        return true;
      },

      updateEntryCount: (entryId, statusId, count) => {
        if (!isCount(count)) return;
        set((s) => ({
          entries: s.entries.map((e) =>
            e.id === entryId ? { ...e, counts: { ...e.counts, [statusId]: count } } : e
          ),
        }));
      },

      setWipLimit: (limit) =>
        set({ wipLimit: limit !== null && isCount(limit) && limit > 0 ? limit : null }),

      reset: () => set({ entries: [], wipLimit: null }),

      restore: (state) =>
        set({ columns: state.columns, entries: state.entries, wipLimit: state.wipLimit }),
    }),
    {
      name: "agile-toolkit:cumulative-flow",
      storage: safeJSONStorage("cumulative-flow"),
      // v0 had no version; its state loads unchanged (colours are kept but
      // no longer drawn, zero-filled snapshots stay as they were typed).
      version: 1,
      migrate: (stored) => migrateCfdState(stored) as unknown as CFDStore,
      merge: (persisted, current) => ({ ...current, ...migrateCfdState(persisted) }),
      partialize: (s) => ({
        columns: s.columns,
        entries: s.entries,
        wipLimit: s.wipLimit,
        source: s.source,
      }),
    }
  )
);
