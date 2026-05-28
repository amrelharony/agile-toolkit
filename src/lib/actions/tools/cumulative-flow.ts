/**
 * Cumulative Flow Diagram — tool-local actions.
 *
 * Category: Metrics & Dashboards (squad S2)
 * Agent surface: tool.cumulative_flow.*
 *
 * Pure compute over per-day WIP + cumulative-done series. Derives the flow
 * metrics a CFD exists to surface: average throughput, average WIP, and an
 * approximate cycle time via Little's Law (WIP / throughput), plus XmR
 * control limits on WIP to flag instability. Reuses the shared xmrLimits
 * helper. No persistence — the agent passes the series.
 */

import { z } from "zod";
import { registry } from "../registry";
import { xmrLimits } from "@/lib/analytics/control-chart";

const round2 = (n: number) => Math.round(n * 100) / 100;

// ──────── tool.cumulative_flow.compute ────────
registry.register({
  id: "tool.cumulative_flow.compute",
  toolId: "tool.cumulative_flow",
  name: "compute",
  category: "read",
  description:
    "Compute flow metrics from a CFD. Given wip[] (in-progress count per day) and done[] (CUMULATIVE completed count per day, oldest first, equal length), returns {days, avgWip, throughputPerDay, littlesLawCycleTimeDays (avgWip/throughput; null if no throughput), wipControlLimits: {centerLine, ucl, lcl}, wipStable (all WIP within limits)}. Pure.",
  paramsSchema: z
    .object({
      wip: z
        .array(z.number().min(0))
        .min(2)
        .describe("In-progress item count per day, oldest first."),
      done: z
        .array(z.number().min(0))
        .min(2)
        .describe("Cumulative completed count per day, oldest first. Same length as wip."),
    })
    .refine((p) => p.wip.length === p.done.length, {
      message: "wip and done must be the same length.",
    }),
  handler: async (params) => {
    const { wip, done } = params;
    const days = wip.length;
    const avgWip = wip.reduce((a, b) => a + b, 0) / days;
    // Cumulative done is monotonic; throughput = total completed / elapsed days.
    const throughputPerDay = (done[days - 1] - done[0]) / (days - 1);
    const littlesLawCycleTimeDays = throughputPerDay > 0 ? avgWip / throughputPerDay : null;
    const limits = xmrLimits(wip, true);
    const wipStable = wip.every((v) => v >= limits.lcl && v <= limits.ucl);
    return {
      days,
      avgWip: round2(avgWip),
      throughputPerDay: round2(throughputPerDay),
      littlesLawCycleTimeDays:
        littlesLawCycleTimeDays === null ? null : round2(littlesLawCycleTimeDays),
      wipControlLimits: {
        centerLine: round2(limits.centerLine),
        ucl: round2(limits.ucl),
        lcl: round2(limits.lcl),
      },
      wipStable,
    };
  },
});
