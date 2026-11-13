/**
 * Cycle Time Analyzer — shared types.
 *
 * Finished stories and Flow-board cards are read live from the workspace
 * (lib/flow), never copied here. Only the items typed by hand, for work
 * tracked somewhere the toolkit can't read, live in the tool's own
 * device-local store (see use-cycle-time-store.ts).
 */

import type { StageId } from "@/lib/flow";

/** An item typed by hand: what it was, and the days it started and finished. */
export interface WorkItem {
  id: string;
  name: string;
  description?: string;
  /** Local "YYYY-MM-DD". */
  startDate: string;
  /** Local "YYYY-MM-DD". */
  endDate: string;
}

/** The SLE percentiles the page offers. */
export const SLE_PERCENTILES = [50, 75, 85, 90, 95] as const;
export type SlePercentile = (typeof SLE_PERCENTILES)[number];

export interface CycleTimeStore {
  items: WorkItem[];
  /** The percentile the SLE is stated at. */
  targetPct: SlePercentile;
  /** A service-level target in days to check finished and ageing work against; null for none. */
  sleTargetDays: number | null;
  /**
   * The statuses counted as waiting for the flow efficiency (Time in each
   * status), in lib/flow STAGE_ORDER; the rest count as active.
   */
  waitingStages: StageId[];
  /** Adds a validated item. */
  addItem: (item: Omit<WorkItem, "id">) => WorkItem;
  removeItem: (id: string) => void;
  updateItem: (id: string, updates: Partial<Omit<WorkItem, "id">>) => void;
  setTargetPct: (pct: SlePercentile) => void;
  setSleTargetDays: (days: number | null) => void;
  setWaitingStages: (stages: readonly string[]) => void;
  /** Removes every typed item. */
  reset: () => void;
  /** Put the typed items back (Undo of a reset). */
  restoreItems: (items: WorkItem[]) => void;
}

/** Where a finished item came from. */
export type CycleSource = "story" | "card" | "typed";

/** A finished item with its cycle time, from any source. */
export interface CycleRow {
  id: string;
  title: string;
  source: CycleSource;
  /** Local "YYYY-MM-DD". */
  startedOn: string;
  /** Local "YYYY-MM-DD". */
  doneOn: string;
  /** Whole days, start and finish both counted: a same-day item is 1. */
  days: number;
}

export interface HistogramDatum {
  bucket: string;
  count: number;
}

export interface ScatterDatum {
  /** The finish day as a day number, for a time axis. */
  x: number;
  doneOn: string;
  cycleTime: number;
  name: string;
  source: CycleSource;
}
