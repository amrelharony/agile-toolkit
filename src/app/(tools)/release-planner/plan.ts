/**
 * Everything the page, the verdict and the Markdown export say about one
 * release, computed once from the inputs: the scope after the expected
 * change, the forecast (or why there isn't one yet), the confidence rows
 * and the answers for the target date.
 */

import { MIN_SAMPLE, enoughData } from "@/lib/analytics/min-sample";
import type { Velocity } from "@/lib/sprints/metrics";
import { effectiveScope, type ResolvedScope } from "./scope-source";
import type { VelocitySource } from "./velocity-source";
import {
  chanceWithin,
  deliverableIn,
  finishDate,
  simulateRelease,
  sprintsUntil,
  type Deliverable,
  type SimulationOptions,
  type SprintForecast,
} from "@/lib/sprints/release-forecast";

/** The draws a forecast samples: points per sprint, oldest first, and what each one was. */
export interface VelocitySample {
  points: number[];
  /** Sprint names, or "Sprint 1…" for typed numbers. */
  labels: string[];
}

export interface ReleasePlanInput {
  scope: ResolvedScope;
  scopeChangePct: number | null;
  velocitySource: VelocitySource;
  sample: VelocitySample;
  /** The shared headline velocity (latest three sprints). */
  headline: Velocity;
  lengthDays: number;
  lengthFrom: "user" | "cadence";
  start: { date: string; from: "user" | "sprint" | "today" };
  /** The target date, or "" when none is set. */
  targetDate: string;
  /** "legacy": derived from a version-0 target in sprints. */
  targetFrom: "user" | "legacy" | null;
}

/**
 * Why no forecast is shown yet. "no-progress": every sampled sprint
 * delivered 0. "beyond-cap": half the runs or more are still short of the
 * scope after `MAX_SPRINTS` sprints.
 */
export type Blocked = "no-scope" | "no-sample" | "small-sample" | "no-progress" | "beyond-cap";

export interface ConfidenceRow {
  pct: 50 | 75 | 85 | 95;
  /** Sprints needed, or null when that share of runs never finishes. */
  sprints: number | null;
  /** The finish date (YYYY-MM-DD), or "" with no sprint count. */
  date: string;
}

/**
 * The answers for the target date. "Scope we can deliver by then" needs
 * only the velocity sample, so it is there without a scope too (a fixed
 * date with open scope is the usual reason to ask); the chance needs the
 * scope's forecast.
 */
export interface TargetAnswer {
  date: string;
  /** Whole sprints that fit between the start and the target. */
  sprints: number;
  /** 0–1: share of runs that finish within those sprints; null without a forecast (no scope). */
  chance: number | null;
  /** What those sprints deliver; null when no sprint fits. */
  deliverable: Deliverable | null;
}

export interface ReleasePlan extends ReleasePlanInput {
  /** Scope after the expected change; null without a scope. */
  effective: number | null;
  blocked: Blocked | null;
  forecast: SprintForecast | null;
  rows: ConfidenceRow[];
  target: TargetAnswer | null;
}

const PCTS = [50, 75, 85, 95] as const;

/** The forecast and its answers, or the reason there aren't any yet. */
export function planRelease(input: ReleasePlanInput, options: SimulationOptions = {}): ReleasePlan {
  const effective = effectiveScope(input.scope.points, input.scopeChangePct);
  const n = input.sample.points.length;
  const blocked: Blocked | null =
    effective === null
      ? "no-scope"
      : n === 0
        ? "no-sample"
        : !enoughData(n, MIN_SAMPLE.forecast)
          ? "small-sample"
          : null;
  const forecast =
    blocked === null && effective !== null
      ? simulateRelease(effective, input.sample.points, options)
      : null;
  const stalled = forecast !== null && forecast.p50 === null;
  const stalledAs: Blocked = input.sample.points.every((p) => p === 0)
    ? "no-progress"
    : "beyond-cap";

  const rows: ConfidenceRow[] =
    forecast && !stalled
      ? PCTS.map((pct) => {
          const sprints = forecast[`p${pct}` as const];
          return {
            pct,
            sprints,
            date: sprints === null ? "" : finishDate(input.start.date, sprints, input.lengthDays),
          };
        })
      : [];

  // Wherever the sample is big enough: without a scope, and when the scope
  // is out of reach (no progress, beyond the cap), what the date delivers
  // is still the answer to give.
  let target: TargetAnswer | null = null;
  if (input.targetDate && enoughData(n, MIN_SAMPLE.forecast)) {
    const sprints = sprintsUntil(input.start.date, input.targetDate, input.lengthDays);
    target = {
      date: input.targetDate,
      sprints,
      chance: forecast ? chanceWithin(forecast, sprints) : null,
      deliverable: sprints >= 1 ? deliverableIn(input.sample.points, sprints, options) : null,
    };
  }

  return {
    ...input,
    effective,
    blocked: stalled ? stalledAs : blocked,
    forecast,
    rows,
    target,
  };
}

/**
 * The target date: the one picked, else a version-0 target in sprints
 * turned into the end of that many sprints from the start.
 */
export function resolveTargetDate(
  config: { targetDate: string; sprintsToReleaseTarget?: string },
  start: string,
  lengthDays: number
): { date: string; from: "user" | "legacy" | null } {
  if (/^\d{4}-\d{2}-\d{2}$/.test(config.targetDate))
    return { date: config.targetDate, from: "user" };
  const n = Number(config.sprintsToReleaseTarget);
  if (config.sprintsToReleaseTarget && Number.isInteger(n) && n > 0) {
    const date = finishDate(start, n, lengthDays);
    if (date) return { date, from: "legacy" };
  }
  return { date: "", from: null };
}

/** "+10%", "−5%", "0%". */
export function signedPct(pct: number | null): string {
  const v = pct ?? 0;
  const r = Math.round(v * 10) / 10;
  if (r === 0) return "0%";
  return `${r > 0 ? "+" : "−"}${Math.abs(r)}%`;
}
