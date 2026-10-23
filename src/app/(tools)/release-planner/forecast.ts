/**
 * The Release Planner's Monte Carlo and the two questions it answers:
 *
 *   - "When will it be done?"  sprints needed per run, as P50/P75/P85/P95;
 *   - "By <date>?"             the chance of finishing by then, and the
 *                              scope the team can count on by then (P50
 *                              and P85).
 *
 * Each run replays the team's history: it draws a past sprint's points at
 * random, sprint after sprint, until the scope is covered. A sprint that
 * delivered 0 is drawn like any other (the shared `runMonteCarlo` drops
 * zero draws, which is right for throughput counts but makes a release
 * forecast optimistic), so this module runs its own loop.
 *
 * The generator is seeded, so the same inputs give the same numbers on
 * every render: an unrelated edit no longer nudges the dates by a sprint.
 * Percentiles use the nearest-rank rule of `percentile` in
 * lib/sprints/metrics; a run that never finishes ranks after every run
 * that does, instead of being dropped.
 */

import { format } from "date-fns";
import { isoDayNumber, isoFromDayNumber } from "@/lib/sprints/calendar";

export const ITERATIONS = 10_000;
/** A run still short of the scope after this many sprints counts as never finishing. */
export const MAX_SPRINTS = 500;
const SEED = 0x5eed;

export interface SimulationOptions {
  iterations?: number;
  seed?: number;
  maxSprints?: number;
}

/** mulberry32: a small, fast seeded generator, plenty for resampling. */
function seeded(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Nearest rank on an ascending list: the smallest value with at least p% at or below it. */
function rankAt(sorted: ArrayLike<number>, p: number): number {
  const rank = Math.ceil((Math.min(100, Math.max(0, p)) / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

const usable = (samples: readonly number[]) => samples.filter((v) => Number.isFinite(v) && v >= 0);

export interface SprintForecast {
  scope: number;
  iterations: number;
  /** Runs per sprint count, ascending; runs that never finished are left out. */
  histogram: { sprints: number; count: number }[];
  /** Sprints needed at each confidence; null when that many runs never finish. */
  p50: number | null;
  p75: number | null;
  p85: number | null;
  p95: number | null;
  /** Runs still short of the scope after `maxSprints`. */
  unfinished: number;
  /** Sprints needed per run, ascending (Infinity for a run that never finished). */
  runs: Float64Array;
}

/**
 * Sprints needed to deliver `scope`, over `iterations` runs. Null without a
 * scope or without a sample. When every sampled sprint delivered 0, every
 * run is unfinished and the percentiles are null.
 */
export function simulateRelease(
  scope: number,
  samples: readonly number[],
  { iterations = ITERATIONS, seed = SEED, maxSprints = MAX_SPRINTS }: SimulationOptions = {}
): SprintForecast | null {
  const draws = usable(samples);
  if (!(scope > 0) || draws.length === 0 || iterations < 1) return null;
  const rng = seeded(seed);
  const runs = new Float64Array(iterations);
  let unfinished = 0;
  const neverDone = draws.every((d) => d === 0);
  for (let i = 0; i < iterations; i++) {
    if (neverDone) {
      runs[i] = Number.POSITIVE_INFINITY;
      unfinished++;
      continue;
    }
    let left = scope;
    let sprints = 0;
    while (left > 0 && sprints < maxSprints) {
      left -= draws[Math.floor(rng() * draws.length)];
      sprints++;
    }
    if (left > 0) {
      runs[i] = Number.POSITIVE_INFINITY;
      unfinished++;
    } else {
      runs[i] = sprints;
    }
  }
  runs.sort();

  const counts = new Map<number, number>();
  for (let i = 0; i < runs.length; i++) {
    if (Number.isFinite(runs[i])) counts.set(runs[i], (counts.get(runs[i]) ?? 0) + 1);
  }
  const at = (p: number) => {
    const v = rankAt(runs, p);
    return Number.isFinite(v) ? v : null;
  };
  return {
    scope,
    iterations,
    histogram: Array.from(counts.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([sprints, count]) => ({ sprints, count })),
    p50: at(50),
    p75: at(75),
    p85: at(85),
    p95: at(95),
    unfinished,
    runs,
  };
}

/** Share of runs (0–1) done within `sprints` sprints. */
export function chanceWithin(forecast: SprintForecast, sprints: number): number {
  if (forecast.iterations === 0 || !(sprints >= 1)) return 0;
  // Runs are ascending, so count until the first one that takes longer.
  let done = 0;
  while (done < forecast.runs.length && forecast.runs[done] <= sprints) done++;
  return done / forecast.iterations;
}

export interface Deliverable {
  /** Points delivered in at least half the runs. */
  p50: number;
  /** Points delivered in at least 85% of the runs: the amount to promise. */
  p85: number;
}

/** Points the team delivers in `sprints` sprints; null without a sample or a sprint. */
export function deliverableIn(
  samples: readonly number[],
  sprints: number,
  { iterations = ITERATIONS, seed = SEED, maxSprints = MAX_SPRINTS }: SimulationOptions = {}
): Deliverable | null {
  const draws = usable(samples);
  const n = Math.min(Math.floor(sprints), maxSprints);
  if (draws.length === 0 || !(n >= 1) || iterations < 1) return null;
  const rng = seeded(seed);
  const sums = new Float64Array(iterations);
  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (let s = 0; s < n; s++) sum += draws[Math.floor(rng() * draws.length)];
    sums[i] = sum;
  }
  sums.sort();
  // "At least X in 85% of runs" is the 15th percentile of what runs deliver.
  return {
    p50: Math.round(rankAt(sums, 50) * 10) / 10,
    p85: Math.round(rankAt(sums, 15) * 10) / 10,
  };
}

/* ── Dates ───────────────────────────────────────────────────────────── */

/** `iso` moved by `days` calendar days; "" when `iso` isn't a date. */
export function addDaysIso(iso: string, days: number): string {
  const n = isoDayNumber(iso);
  return n === null ? "" : isoFromDayNumber(n + Math.round(days));
}

/**
 * The end of the `sprints`-th sprint from `start`, on the sprints'
 * convention (a sprint of L days ends on start + L, see lib/sprints/series).
 */
export function finishDate(start: string, sprints: number, lengthDays: number): string {
  return addDaysIso(start, sprints * lengthDays);
}

/** Whole sprints that end on or before `target`; 0 when none fits (or a date is missing). */
export function sprintsUntil(start: string, target: string, lengthDays: number): number {
  const a = isoDayNumber(start);
  const b = isoDayNumber(target);
  if (a === null || b === null || !(lengthDays >= 1) || b <= a) return 0;
  return Math.floor((b - a) / lengthDays);
}

/** "Jun 7, 2027"; "—" for a missing date. */
export function formatDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return "—";
  // A local calendar date: `new Date("2027-06-07")` is UTC midnight, a day
  // early anywhere west of UTC.
  return format(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])), "MMM d, yyyy");
}
