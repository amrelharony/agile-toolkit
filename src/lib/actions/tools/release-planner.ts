/**
 * Release Planner — tool-local actions.
 *
 * Category: Sprint Planning & Estimation (squad S1 — calculator)
 * Agent surface: tool.release_planner.*
 *
 * Pure compute, no persistence (plan D2: calculators expose compute_*). The
 * forecast runs the same seeded Monte Carlo as the page
 * (lib/sprints/release-forecast): sprints that delivered 0 are drawn like
 * any other, percentiles use the nearest-rank rule, and a run that never
 * finishes ranks last instead of being dropped — so an agent and the page
 * give the same numbers. No mcpHandler: it runs identically server- and
 * client-side.
 */

import { z } from "zod";
import { registry } from "../registry";
import {
  chanceWithin,
  deliverableIn,
  finishDate,
  simulateRelease,
  sprintsUntil,
} from "@/lib/sprints/release-forecast";

const IsoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const ForecastParams = z.object({
  backlogPoints: z.number().min(0).describe("Remaining scope in story points."),
  velocities: z
    .array(z.number().min(0))
    .min(1)
    .describe(
      "Completed points of past sprints, e.g. the last 6–8. Sprints that delivered 0 count: they are real history."
    ),
  scopeChangePct: z
    .number()
    .min(-90)
    .max(500)
    .optional()
    .describe("Expected scope change, as a percent of the backlog (default 0; negative to cut)."),
  scopeBufferPct: z
    .number()
    .min(0)
    .optional()
    .describe("Older name for scopeChangePct; used when scopeChangePct is absent."),
  iterations: z
    .number()
    .int()
    .min(100)
    .max(50000)
    .optional()
    .describe("Monte-Carlo iterations (default 10000)."),
  startDate: IsoDay.optional().describe("When the first forecast sprint starts, for dates."),
  sprintLengthDays: z
    .number()
    .int()
    .min(1)
    .max(60)
    .optional()
    .describe("Calendar days per sprint."),
  targetDate: IsoDay.optional().describe(
    "Answer 'by this date?': the chance of finishing and the scope deliverable by then."
  ),
});

type ForecastInput = z.infer<typeof ForecastParams>;

export function releaseForecast(params: ForecastInput) {
  const change = params.scopeChangePct ?? params.scopeBufferPct ?? 0;
  const effectiveBacklog = Math.round(params.backlogPoints * (1 + change / 100) * 10) / 10;
  const velocities = params.velocities.filter((v) => Number.isFinite(v) && v >= 0);
  const avgVelocity =
    velocities.length > 0
      ? Math.round((velocities.reduce((a, b) => a + b, 0) / velocities.length) * 10) / 10
      : 0;
  const options = params.iterations ? { iterations: params.iterations } : {};
  const forecast = simulateRelease(effectiveBacklog, velocities, options);

  // Nothing left to deliver takes no sprints; no history means we can't say.
  const done = !(effectiveBacklog > 0);
  const finite = forecast ? Array.from(forecast.runs).filter(Number.isFinite) : [];
  const sprints = done
    ? { p50: 0, p75: 0, p85: 0, p95: 0 }
    : {
        p50: forecast?.p50 ?? null,
        p75: forecast?.p75 ?? null,
        p85: forecast?.p85 ?? null,
        p95: forecast?.p95 ?? null,
      };
  const { startDate, sprintLengthDays: length, targetDate } = params;
  const datesKnown = Boolean(startDate && length);
  const dateAt = (n: number | null) =>
    datesKnown && n !== null ? finishDate(startDate as string, n, length as number) : null;

  let target: {
    date: string;
    sprints: number;
    chance: number;
    deliverable: { p50: number; p85: number } | null;
  } | null = null;
  if (datesKnown && targetDate) {
    const n = sprintsUntil(startDate as string, targetDate, length as number);
    target = {
      date: targetDate,
      sprints: n,
      chance: forecast ? Math.round(chanceWithin(forecast, n) * 1000) / 1000 : 0,
      deliverable: deliverableIn(velocities, n, options),
    };
  }

  return {
    effectiveBacklog,
    avgVelocity,
    sampleSize: velocities.length,
    sprints,
    unfinishedRuns: forecast?.unfinished ?? 0,
    minSprints: done ? 0 : finite.length > 0 ? finite[0] : null,
    maxSprints: done ? 0 : finite.length > 0 ? finite[finite.length - 1] : null,
    finishDates: datesKnown
      ? { p50: dateAt(sprints.p50), p85: dateAt(sprints.p85), p95: dateAt(sprints.p95) }
      : null,
    target,
  };
}

// ──────── tool.release_planner.forecast ────────
registry.register({
  id: "tool.release_planner.forecast",
  toolId: "tool.release_planner",
  name: "forecast",
  category: "read",
  description:
    "Monte-Carlo release forecast, the same as the Release Planner page: how many sprints a backlog needs at the team's past velocities (0-point sprints count). Returns {effectiveBacklog, avgVelocity, sampleSize, sprints: {p50, p75, p85, p95} (null when that many runs never finish), unfinishedRuns, minSprints, maxSprints, finishDates: {p50, p85, p95} (with startDate + sprintLengthDays), target: {date, sprints, chance (0–1), deliverable: {p50, p85} points} (with targetDate)}. Pure — no persistence.",
  paramsSchema: ForecastParams,
  handler: async (params) => releaseForecast(params),
});
