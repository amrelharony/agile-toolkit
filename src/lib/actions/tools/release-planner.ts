/**
 * Release Planner — tool-local actions.
 *
 * Category: Sprint Planning & Estimation (squad S1 — calculator)
 * Agent surface: tool.release_planner.*
 *
 * Pure compute, no persistence (plan D2: calculators expose compute_*). The
 * forecast reuses the same Monte-Carlo throughput engine the in-app tool
 * uses (`simulateThroughputCompletion`), so an agent and the UI produce the
 * same numbers. No mcpHandler — the computation is deterministic-shaped and
 * runs identically server- and client-side.
 */

import { z } from "zod";
import { registry } from "../registry";
import { simulateThroughputCompletion } from "@/lib/analytics/monte-carlo";

// ──────── tool.release_planner.forecast ────────
registry.register({
  id: "tool.release_planner.forecast",
  toolId: "tool.release_planner",
  name: "forecast",
  category: "read",
  description:
    "Monte-Carlo forecast of how many sprints are needed to finish a backlog given recent per-sprint velocities. Returns {effectiveBacklog, avgVelocity, sprints: {p50, p75, p85, p95}, minSprints, maxSprints}. Pure — no persistence.",
  paramsSchema: z.object({
    backlogPoints: z.number().min(0).describe("Remaining backlog size in story points."),
    velocities: z
      .array(z.number())
      .min(1)
      .describe("Recent per-sprint completed points, e.g. the last 6–8 sprints."),
    scopeBufferPct: z
      .number()
      .min(0)
      .optional()
      .describe("Extra scope buffer added to the backlog, as a percent (default 0)."),
    iterations: z
      .number()
      .int()
      .min(100)
      .max(50000)
      .optional()
      .describe("Monte-Carlo iterations (default 5000)."),
  }),
  handler: async (params) => {
    const velocities = params.velocities.filter((v) => Number.isFinite(v) && v > 0);
    const effectiveBacklog = params.backlogPoints * (1 + (params.scopeBufferPct ?? 0) / 100);
    if (velocities.length === 0 || effectiveBacklog <= 0) {
      return {
        effectiveBacklog,
        avgVelocity: 0,
        sprints: { p50: 0, p75: 0, p85: 0, p95: 0 },
        minSprints: 0,
        maxSprints: 0,
      };
    }
    const r = simulateThroughputCompletion(effectiveBacklog, velocities, params.iterations ?? 5000);
    const avgVelocity = velocities.reduce((a, b) => a + b, 0) / velocities.length;
    return {
      effectiveBacklog,
      avgVelocity,
      sprints: {
        p50: r.percentiles[50],
        p75: r.percentiles[75],
        p85: r.percentiles[85],
        p95: r.percentiles[95],
      },
      minSprints: r.min,
      maxSprints: r.max,
    };
  },
});
