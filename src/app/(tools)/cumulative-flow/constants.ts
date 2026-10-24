/**
 * Cumulative Flow Diagram — the seed columns for typed snapshots and the
 * board ranges. The sample floors for the statistics are lib/analytics
 * min-sample's (MIN_SAMPLE.average, .trend, .changePoint).
 */

import type { StatusColumn } from "./types";

/** The columns typed snapshots start with: one queue, two in progress, done last. */
export const DEFAULT_COLUMNS: StatusColumn[] = [
  { id: "col-1", name: "To Do" },
  { id: "col-2", name: "In Progress" },
  { id: "col-3", name: "In Review" },
  { id: "col-4", name: "Done" },
];

/** The Flow board's range choices, in days back from today. */
export const FLOW_RANGES = [14, 30, 90] as const;
export type FlowRangeDays = (typeof FLOW_RANGES)[number];
export const DEFAULT_FLOW_RANGE: FlowRangeDays = 30;

/** The most count a typed snapshot accepts for one column. */
export const MAX_COUNT = 100_000;
