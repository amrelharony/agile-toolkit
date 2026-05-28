/**
 * Burnup Generator — tool-local actions.
 *
 * Category: Metrics & Dashboards (squad S2)
 * Agent surface: tool.burnup.*
 *
 * Pure compute. Given the scope line and the completed line (one entry per
 * elapsed day), returns progress, scope creep, and a least-squares forecast
 * of the day the completed line meets current scope. No persistence.
 */

import { z } from "zod";
import { registry } from "../registry";

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Least-squares slope + intercept of ys against x = 0..n-1. */
function fitLine(ys: number[]): { slope: number; intercept: number } {
  const n = ys.length;
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0 };
  const sumX = (n * (n - 1)) / 2;
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = ys.reduce((a, y, i) => a + i * y, 0);
  const sumXX = ys.reduce((a, _y, i) => a + i * i, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

// ──────── tool.burnup.compute ────────
registry.register({
  id: "tool.burnup.compute",
  toolId: "tool.burnup",
  name: "compute",
  category: "read",
  description:
    "Compute burnup status. Given scope[] and completed[] (per elapsed day, oldest first, equal length), returns {currentScope, currentCompleted, remaining, percentComplete, scopeCreep (scope[last]−scope[first]), completedPerDay, forecastDoneDay (fractional day index when completed meets current scope; null if not progressing or already done)}. Pure.",
  paramsSchema: z
    .object({
      scope: z.array(z.number().min(0)).min(1).describe("Total scope per day, oldest first."),
      completed: z
        .array(z.number().min(0))
        .min(1)
        .describe("Completed points per day, oldest first. Same length as scope."),
    })
    .refine((p) => p.scope.length === p.completed.length, {
      message: "scope and completed must be the same length.",
    }),
  handler: async (params) => {
    const { scope, completed } = params;
    const last = scope.length - 1;
    const currentScope = scope[last];
    const currentCompleted = completed[last];
    const remaining = currentScope - currentCompleted;
    const { slope, intercept } = fitLine(completed);
    // Day at which the completed trend reaches the current scope line.
    let forecastDoneDay: number | null = null;
    if (remaining <= 0) {
      forecastDoneDay = last; // already met scope
    } else if (slope > 0) {
      forecastDoneDay = round1((currentScope - intercept) / slope);
    }
    return {
      currentScope,
      currentCompleted,
      remaining: round1(remaining),
      percentComplete: currentScope > 0 ? Math.round((currentCompleted / currentScope) * 100) : 0,
      scopeCreep: round1(currentScope - scope[0]),
      completedPerDay: round1(slope),
      forecastDoneDay,
    };
  },
});
