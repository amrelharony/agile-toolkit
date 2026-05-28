/**
 * Cycle Time Analyzer — tool-local actions.
 *
 * Category: Metrics & Dashboards (squad S2)
 * Agent surface: tool.cycle_time.*
 *
 * Pure compute over a caller-supplied set of completed work-item cycle
 * times (in days). Returns the percentile summary teams use to set a
 * Service Level Expectation (SLE) — P85 is the conventional SLE target —
 * plus IQR-based outlier detection. Reuses the shared `quantile` helper so
 * the numbers match the in-app analyzer. No persistence.
 */

import { z } from "zod";
import { registry } from "../registry";
import { quantile } from "@/lib/analytics/anomaly";

const round1 = (n: number) => Math.round(n * 10) / 10;

// ──────── tool.cycle_time.compute_percentiles ────────
registry.register({
  id: "tool.cycle_time.compute_percentiles",
  toolId: "tool.cycle_time",
  name: "compute_percentiles",
  category: "read",
  description:
    "Summarise completed work-item cycle times (in days). Returns {count, average, min, max, p50, p85, p95, sleTarget (= P85, the conventional Service Level Expectation), outliers: number[] (IQR fences)}. Pure.",
  paramsSchema: z.object({
    durations: z
      .array(z.number().min(0))
      .min(1)
      .describe("Completed work-item cycle times, in days (one entry per item)."),
  }),
  handler: async (params) => {
    const sorted = [...params.durations].sort((a, b) => a - b);
    const n = sorted.length;
    const sum = sorted.reduce((a, b) => a + b, 0);
    const q1 = quantile(sorted, 0.25);
    const q3 = quantile(sorted, 0.75);
    const iqr = q3 - q1;
    const lowerFence = q1 - 1.5 * iqr;
    const upperFence = q3 + 1.5 * iqr;
    const p85 = quantile(sorted, 0.85);
    return {
      count: n,
      average: round1(sum / n),
      min: sorted[0],
      max: sorted[n - 1],
      p50: round1(quantile(sorted, 0.5)),
      p85: round1(p85),
      p95: round1(quantile(sorted, 0.95)),
      sleTarget: round1(p85),
      outliers: sorted.filter((v) => v < lowerFence || v > upperFence),
    };
  },
});
