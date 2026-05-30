/**
 * Cycle Time Analyzer — shared types.
 *
 * The tool persists work items to its own isolated localStorage zustand store
 * (see use-cycle-time-store.ts). These types describe that store plus the
 * derived shapes the charts consume.
 */

export interface WorkItem {
  id: string;
  name: string;
  description?: string;
  startDate: string;
  endDate: string;
}

export interface CycleTimeStore {
  items: WorkItem[];
  addItem: () => void;
  removeItem: (id: string) => void;
  updateItem: (id: string, updates: Partial<Omit<WorkItem, "id">>) => void;
  reset: () => void;
}

/** A work item with its derived cycle time (null when dates are missing/invalid). */
export type WorkItemWithCycleTime = WorkItem & { cycleTime: number | null };

export interface CycleStats {
  avg: number;
  median: number;
  p85: number;
  stddev: number;
}

export interface HistogramDatum {
  bucket: string;
  count: number;
}

export interface ScatterDatum {
  idx: number;
  cycleTime: number;
  name: string;
}
