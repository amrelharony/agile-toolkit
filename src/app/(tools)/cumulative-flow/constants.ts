/**
 * Cumulative Flow Diagram — seed columns/colors, the per-snapshot entry
 * factory, and the XmR sample floor.
 */

import { todayLocalISO } from "@/lib/utils/formatters";
import type { DataEntry, StatusColumn } from "./types";

export const DEFAULT_COLORS = [
  "#64748b",
  "#00f0ff",
  "#ff00aa",
  "#00ff88",
  "#f59e0b",
  "#a855f7",
  "#f97316",
  "#3b82f6",
];

export const DEFAULT_COLUMNS: StatusColumn[] = [
  { id: "col-1", name: "To Do", color: "#64748b" },
  { id: "col-2", name: "In Progress", color: "#00f0ff" },
  { id: "col-3", name: "In Review", color: "#ff00aa" },
  { id: "col-4", name: "Done", color: "#00ff88" },
];

export const createEntry = (columns: StatusColumn[]): DataEntry => ({
  id: crypto.randomUUID(),
  date: todayLocalISO(),
  counts: Object.fromEntries(columns.map((c) => [c.id, 0])),
});

// XmR control limits require enough observations for the moving-range
// estimate of σ̂ to be statistically stable. Below ~8 samples the limits
// collapse toward the centerline (or expand wildly with a single outlier),
// producing false alarms — Wheeler's guidance is "at least 6-10 baseline
// observations before treating limits as real." We pick 8 as the floor.
export const MIN_XMR_SAMPLES = 8;
