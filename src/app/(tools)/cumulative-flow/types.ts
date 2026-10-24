/**
 * Cumulative Flow Diagram — shared types.
 *
 * The chart is drawn from one of three sources: the Sprint board's stories
 * or the Flow board's cards (read live from the workspace through
 * lib/flow, never copied here), or snapshots typed by hand. Only the typed
 * snapshots and their columns are stored, in the tool's own device-local
 * store (see use-cfd-store.ts). The Wip* types describe the derived shapes
 * the WIP control chart consumes (structural subsets of the analytics
 * primitives' returns, so the entry can pass those values directly).
 */

/** Where the chart's counts come from. */
export type CfdSource = "sprint" | "flow" | "typed";

export interface StatusColumn {
  id: string;
  name: string;
  /**
   * A hex colour older versions stored with the column. Ignored: the chart
   * colours a column by its position, from the theme's tokens, so it reads
   * in every theme.
   */
  color?: string;
  /** Optional purpose/definition for the column (shown in tooltip). */
  description?: string;
}

export interface DataEntry {
  id: string;
  /** Local "YYYY-MM-DD"; one snapshot per date. */
  date: string;
  /** Items per column id. A column added after the snapshot has no count: it reads as 0. */
  counts: Record<string, number>;
  /** Optional note for the snapshot day. */
  description?: string;
}

/** What a reset takes away, for its Undo. */
export interface TypedSnapshotState {
  columns: StatusColumn[];
  entries: DataEntry[];
  wipLimit: number | null;
}

export interface CFDStore extends TypedSnapshotState {
  /** The source picked last on this device; null picks one from the data. */
  source: CfdSource | null;
  setSource: (source: CfdSource | null) => void;
  /** Adds a status column before the last (done) one, so Done stays Done. */
  addColumn: (name: string, description?: string) => void;
  removeColumn: (id: string) => void;
  /** Put back a removed column at `index`, with its counts per entry id. */
  restoreColumn: (column: StatusColumn, index: number, counts: Record<string, number>) => void;
  renameColumn: (id: string, name: string) => void;
  setColumnDescription: (id: string, description: string | undefined) => void;
  /** Adds a validated snapshot; false (and nothing saved) when its date already has one. */
  addEntry: (entry: Omit<DataEntry, "id">) => boolean;
  /** False (and nothing saved) when the change would give two snapshots one date. */
  updateEntry: (id: string, updates: Partial<Omit<DataEntry, "id">>) => boolean;
  /** Sets a count; anything but a whole number from 0 is ignored. */
  updateEntryCount: (entryId: string, statusId: string, count: number) => void;
  setWipLimit: (limit: number | null) => void;
  /** Clears the snapshots and the WIP limit; the columns stay. */
  reset: () => void;
  /** Put the typed snapshots back as they were (Undo of a reset). */
  restore: (state: TypedSnapshotState) => void;
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
