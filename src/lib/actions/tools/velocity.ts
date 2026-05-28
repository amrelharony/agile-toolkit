/**
 * Velocity Tracker — tool-local actions.
 *
 * Category: Metrics & Dashboards (squad S2)
 * Agent surface: tool.velocity.*
 *
 * Read/compute over the SYNCED sprint entity (workspace.sprint.*), so an
 * agent that creates sprints via workspace.sprint.create can immediately
 * compute velocity metrics that match what the in-app tool shows. The
 * forecast + trend reuse the same analytics libs the UI uses
 * (forecastBayesianHolt, mannKendall) so the numbers agree. Pure compute —
 * no new entity, no client change.
 *
 * Velocities come from completed sprints' `pointsCompleted`, oldest→newest.
 * Callers may pass an explicit `velocities` array to compute ad-hoc (e.g.
 * for a what-if) without reading the workspace.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverListEntities } from "../server-store";
import { forecastBayesianHolt } from "@/lib/analytics/forecasting-bayesian";
import { mannKendall } from "@/lib/analytics/trend-test";
import type { Sprint } from "@/lib/stores/workspace-types";

const KIND_SPRINT = "workspace:sprint";

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Completed-sprint velocities, oldest→newest. */
function velocitiesFrom(sprints: Sprint[]): number[] {
  return sprints
    .filter((s) => s.status === "completed" && Number.isFinite(s.pointsCompleted))
    .map((s) => s.pointsCompleted ?? 0);
}

function computeMetrics(velocities: number[]) {
  const n = velocities.length;
  if (n === 0) {
    return {
      count: 0,
      average: 0,
      rollingAverage: 0,
      trend: "none" as const,
      trendSignificant: false,
      predictability: 0,
      forecastNext: null as null | { yHat: number; lower80: number; upper80: number },
      velocities,
    };
  }
  const sum = velocities.reduce((a, b) => a + b, 0);
  const average = sum / n;
  const last3 = velocities.slice(-3);
  const rollingAverage = last3.reduce((a, b) => a + b, 0) / last3.length;
  const variance = velocities.reduce((a, v) => a + (v - average) ** 2, 0) / n;
  const cv = average > 0 ? Math.sqrt(variance) / average : 0;
  // Predictability: 100 = perfectly consistent velocity; lower = noisier.
  // Coefficient-of-variation based, clamped to [0, 100].
  const predictability = Math.max(0, Math.min(100, Math.round((1 - cv) * 100)));
  const mk = mannKendall(velocities); // needs ≥5 points, else trend "none"
  const fc = forecastBayesianHolt(velocities, 1);
  const forecastNext = fc.length
    ? { yHat: round1(fc[0].yHat), lower80: round1(fc[0].lower80), upper80: round1(fc[0].upper80) }
    : null;
  return {
    count: n,
    average: round1(average),
    rollingAverage: round1(rollingAverage),
    trend: mk.trend,
    trendSignificant: mk.significant,
    predictability,
    forecastNext,
    velocities,
  };
}

const paramsSchema = z.object({
  velocities: z
    .array(z.number())
    .optional()
    .describe(
      "Explicit per-sprint completed points (oldest→newest) to compute on. Omit to use completed sprints from the workspace."
    ),
});

// ──────── tool.velocity.compute ────────
registry.register({
  id: "tool.velocity.compute",
  toolId: "tool.velocity",
  name: "compute",
  category: "read",
  description:
    "Compute velocity metrics from completed sprints (or an explicit `velocities` array). Returns {count, average, rollingAverage (last 3), trend (up/down/none, Mann-Kendall), trendSignificant, predictability (0-100, consistency), forecastNext: {yHat, lower80, upper80} | null, velocities}. Pure.",
  paramsSchema,
  handler: async (params) => {
    const velocities =
      params.velocities ?? velocitiesFrom(useWorkspaceStore.getState().sprints ?? []);
    return computeMetrics(velocities);
  },
  mcpHandler: async (params, ctx) => {
    const velocities =
      params.velocities ??
      velocitiesFrom(await serverListEntities<Sprint>(ctx.userId, KIND_SPRINT));
    return computeMetrics(velocities);
  },
});
