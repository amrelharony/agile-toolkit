/**
 * Burndown Generator — tool-local actions.
 *
 * Category: Metrics & Dashboards (squad S2)
 * Agent surface: tool.burndown.*
 *
 * Pure compute. Given the committed total and the remaining-points series
 * (one entry per elapsed day), returns the ideal line, the current
 * ideal-vs-actual gap, and a least-squares projected completion day. No
 * persistence — the agent passes the data.
 */

import { z } from "zod";
import { registry } from "../registry";

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Least-squares fit of ys against x = 0..n-1; returns slope/intercept and
 *  the x where the line crosses zero (null when not descending). */
function fitToZero(ys: number[]): { slope: number; intercept: number; zeroX: number | null } {
  const n = ys.length;
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0, zeroX: null };
  const sumX = (n * (n - 1)) / 2;
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = ys.reduce((a, y, i) => a + i * y, 0);
  const sumXX = ys.reduce((a, _y, i) => a + i * i, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n, zeroX: null };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const zeroX = slope < 0 ? -intercept / slope : null;
  return { slope, intercept, zeroX };
}

// ──────── tool.burndown.compute ────────
registry.register({
  id: "tool.burndown.compute",
  toolId: "tool.burndown",
  name: "compute",
  category: "read",
  description:
    "Compute burndown status. Given totalPoints and remaining[] (one remaining-points reading per elapsed day, oldest first as 0-based day indices), returns {sprintDays, currentDay, currentRemaining, idealRemainingNow, gap (actual−ideal; +behind/−ahead), onTrack, slopePerDay, projectedCompletionDay (fractional day index, null if not burning down), willFinishOnTime}. CONVENTION: the ideal line burns from totalPoints at day index 0 down to 0 at the LAST day index (sprintDays−1) — so pass one `remaining` entry per day with `sprintDays` = that count for a clean burn-to-zero. This is a 0-based day-index model; it differs from a calendar where the ideal would reach 0 at day == sprintDays. Pure.",
  paramsSchema: z.object({
    totalPoints: z.number().min(0),
    remaining: z
      .array(z.number().min(0))
      .min(1)
      .describe("Remaining points at the end of each elapsed day, oldest first."),
    sprintDays: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        "Number of day-indices the ideal line spans (the ideal reaches 0 at index sprintDays−1). Defaults to remaining.length, which makes the ideal burn to 0 exactly at the last reading."
      ),
  }),
  handler: async (params) => {
    const { totalPoints, remaining } = params;
    const sprintDays = params.sprintDays ?? remaining.length;
    const currentDay = remaining.length - 1; // 0-indexed
    const currentRemaining = remaining[currentDay];
    // Ideal line: straight from totalPoints (day 0) to 0 (last day).
    const idealRemainingNow =
      sprintDays > 1 ? totalPoints * (1 - currentDay / (sprintDays - 1)) : 0;
    const gap = currentRemaining - idealRemainingNow;
    const { slope, zeroX } = fitToZero(remaining);
    return {
      sprintDays,
      currentDay,
      currentRemaining,
      idealRemainingNow: round1(idealRemainingNow),
      gap: round1(gap),
      onTrack: gap <= 0,
      slopePerDay: round1(slope),
      projectedCompletionDay: zeroX === null ? null : round1(zeroX),
      willFinishOnTime: zeroX !== null && zeroX <= sprintDays - 1,
    };
  },
});
