/**
 * Cumulative Flow Diagram — shared types.
 *
 * The tool persists columns/entries to its own isolated localStorage zustand
 * store (see use-cfd-store.ts). The Wip* types describe the derived shapes the
 * WIP control chart consumes (structural subsets of the analytics primitives'
 * returns, so the entry can pass those values directly).
 */

export interface StatusColumn {
  id: string;
  name: string;
  color: string;
  /** Optional purpose/definition for the column (shown in tooltip). */
  description?: string;
}

export interface DataEntry {
  id: string;
  date: string;
  counts: Record<string, number>; // statusId -> count
  /** Optional note for the snapshot day. */
  description?: string;
}

export interface CFDStore {
  columns: StatusColumn[];
  entries: DataEntry[];
  wipLimit: number | null;
  addColumn: (name: string, description?: string) => void;
  removeColumn: (id: string) => void;
  renameColumn: (id: string, name: string) => void;
  setColumnDescription: (id: string, description: string | undefined) => void;
  addEntry: () => void;
  removeEntry: (id: string) => void;
  updateEntry: (id: string, updates: Partial<Omit<DataEntry, "id">>) => void;
  updateEntryCount: (entryId: string, statusId: string, count: number) => void;
  setWipLimit: (limit: number | null) => void;
  reset: () => void;
}

export interface WipSeriesPoint {
  date: string;
  value: number;
}

export interface WipLimits {
  ucl: number;
  lcl: number;
  centerLine: number;
}

export interface WipSignal {
  index: number;
  rule: string;
  description: string;
}
