/**
 * The Release Planner's "count items" forecast: from how many items the
 * team finished each week, three questions, each by Monte Carlo:
 *
 *   - "When will N items be done?"   weeks needed per run, P50/P85/P95,
 *                                    and the chance of making a date;
 *   - "How many items by <date>?"    the items finished per run in the
 *                                    weeks up to it: "at least" P50/P85/P95;
 *   - "Where does the date cut?"     an ordered list of features, the date
 *                                    each is likely done (counting the ones
 *                                    before it), and the line the target
 *                                    date draws through them.
 *
 * Weekly throughput is counted the way the flow tools count it
 * (lib/flow `throughputByWeek`, local days, ISO weeks), over complete weeks
 * only: the week in progress is left out, and quiet weeks between the first
 * finish and last week count as 0. Each run replays that history, drawing a
 * past week at random, week after week. A week with nothing finished is
 * drawn like any other (the shared `simulateThroughputCompletion` drops zero
 * draws, which makes a forecast optimistic), so this module runs its own
 * loop, seeded (lib/utils/random), so the same inputs give the same dates
 * on every render.
 *
 * Every feature in the cut line is read from the same runs: run i's week
 * for feature 2 is never before its week for feature 1, so the dates go up
 * the list. Every feature passed in gets a row, in order: one with no items
 * left (an epic whose stories are all done) is done when the ones before it
 * are, so the rows stay in step with the list a page shows.
 *
 * Shared by the Release Planner and tool.release_planner.throughput_forecast.
 */

import { addDays, throughputByWeek, weekOf, type ThroughputPoint } from "@/lib/flow";
import { createRng } from "@/lib/utils/random";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { isoDayNumber } from "@/lib/sprints/calendar";
import { addDaysIso } from "@/lib/sprints/release-forecast";

export const THROUGHPUT_ITERATIONS = 10_000;
/** A run still short of the items after this many weeks counts as never finishing (10 years). */
export const MAX_WEEKS = 520;
/** The history windows the page offers, in weeks; 12 is the default. */
export const THROUGHPUT_WINDOWS = [8, 12, 26, 52] as const;
export type ThroughputWindow = (typeof THROUGHPUT_WINDOWS)[number];
export const DEFAULT_WINDOW: ThroughputWindow = 12;
/** At most this many features on the cut line. */
export const FEATURES_MAX = 30;
/** Items in one feature, at most. */
export const FEATURE_ITEMS_MAX = 1000;
/** Weeks of history needed before a forecast: MIN_SAMPLE.forecast. */
export const MIN_WEEKS = MIN_SAMPLE.forecast;

const SEED = "release-planner:throughput";

/** A finished item for counting: its local done day. */
type Done = { doneOn: string | null };

/**
 * Items finished per complete ISO week, oldest first: the `window` weeks
 * before today's week, never before the week of the first finish. Quiet
 * weeks count as 0; the week in progress isn't counted yet.
 */
export function weeklyThroughput(
  finished: readonly Done[],
  today: string,
  window: number = DEFAULT_WINDOW
): ThroughputPoint[] {
  const current = weekOf(today);
  if (!current || !(window >= 1)) return [];
  const before = finished.filter((f) => {
    const w = weekOf(f.doneOn);
    return w !== null && w < current;
  });
  const series = throughputByWeek(before);
  if (series.length === 0) return [];
  const counts = new Map(series.map((p) => [p.label, p.value]));
  const first = series[0].label;
  const out: ThroughputPoint[] = [];
  for (let k = 1; out.length < window && k <= MAX_WEEKS; k++) {
    const label = weekOf(addDays(today, -7 * k));
    if (!label || label < first) break;
    out.unshift({ label, value: counts.get(label) ?? 0 });
  }
  return out;
}

export interface ParsedCounts {
  values: number[];
  /** Entries that aren't a whole number of items, 0 or more. */
  invalid: string[];
}

/** Weekly counts typed as "3, 5 0\n4": whole numbers, 0 or more. */
export function parseWeeklyCounts(text: string): ParsedCounts {
  const values: number[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const t = raw.trim();
    if (!t) continue;
    const n = Number(t);
    if (Number.isInteger(n) && n >= 0 && n <= 100_000) values.push(n);
    else invalid.push(t);
  }
  return { values, invalid };
}

/** The typed counts' error, or null when every entry is a whole number of items. */
export function validateWeeklyCounts(text: string): string | null {
  const { invalid } = parseWeeklyCounts(text);
  if (invalid.length === 0) return null;
  return `Each week is a whole number of items, 0 or more (not “${invalid[0]}”).`;
}

/** A whole number of items, from 1; null when it isn't one. */
export function validItems(n: unknown): number | null {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 100_000 ? n : null;
}

/** Nearest rank on an ascending list: the smallest value with at least p% at or below it. */
function rankAt(sorted: ArrayLike<number>, p: number): number {
  const rank = Math.ceil((Math.min(100, Math.max(0, p)) / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

const usable = (samples: readonly number[]) =>
  samples.filter((v) => Number.isFinite(v) && v >= 0).map((v) => Math.floor(v));

export interface SimulationOptions {
  iterations?: number;
  seed?: number | string;
  maxWeeks?: number;
}

/** Weeks needed at a confidence; null when that share of runs never finishes. */
export interface WeeksAt {
  p50: number | null;
  p85: number | null;
  p95: number | null;
}

interface Runs {
  /** Per threshold, the weeks each run needed, ascending (Infinity: never). */
  weeks: Float64Array[];
  iterations: number;
}

/**
 * The weeks each run needs to reach each of `thresholds` (cumulative item
 * counts, any order), all from the same draws.
 */
function runThresholds(
  thresholds: readonly number[],
  samples: readonly number[],
  { iterations = THROUGHPUT_ITERATIONS, seed = SEED, maxWeeks = MAX_WEEKS }: SimulationOptions
): Runs {
  const draws = usable(samples);
  const n = Math.max(1, Math.floor(iterations));
  const weeks = thresholds.map(() => new Float64Array(n));
  const top = Math.max(0, ...thresholds);
  const rng = createRng(seed);
  const neverDone = draws.length === 0 || draws.every((d) => d === 0);
  for (let i = 0; i < n; i++) {
    let done = 0;
    let week = 0;
    // The thresholds already reached in this run.
    const reached: number[] = thresholds.map((t) => (t <= 0 ? 0 : -1));
    while (done < top && week < maxWeeks && !neverDone) {
      done += draws[Math.floor(rng() * draws.length)];
      week++;
      for (let k = 0; k < thresholds.length; k++) {
        if (reached[k] < 0 && done >= thresholds[k]) reached[k] = week;
      }
    }
    for (let k = 0; k < thresholds.length; k++) {
      weeks[k][i] = reached[k] < 0 ? Number.POSITIVE_INFINITY : reached[k];
    }
  }
  for (const w of weeks) w.sort();
  return { weeks, iterations: n };
}

function weeksAt(sorted: Float64Array): WeeksAt {
  const at = (p: number) => {
    const v = rankAt(sorted, p);
    return Number.isFinite(v) ? v : null;
  };
  return { p50: at(50), p85: at(85), p95: at(95) };
}

/** Share of runs (0–1) done within `weeks` weeks. */
function chanceWithin(sorted: Float64Array, weeks: number): number {
  if (sorted.length === 0 || !(weeks >= 1)) return 0;
  let done = 0;
  while (done < sorted.length && sorted[done] <= weeks) done++;
  return done / sorted.length;
}

/** Whole weeks from `start` that end on or before `target`; 0 when none fits. */
export function weeksUntil(start: string, target: string): number {
  const a = isoDayNumber(start);
  const b = isoDayNumber(target);
  if (a === null || b === null || b <= a) return 0;
  return Math.floor((b - a) / 7);
}

/** The end of the `weeks`-th week from `start`. */
export function weekEnd(start: string, weeks: number): string {
  return addDaysIso(start, weeks * 7);
}

export interface WhenAnswer {
  items: number;
  weeks: WeeksAt;
  /** The date each confidence lands on; null where that share never finishes. */
  dates: { p50: string | null; p85: string | null; p95: string | null };
  /** Runs per week count, ascending; runs that never finished are left out. */
  histogram: { weeks: number; count: number }[];
  /** Runs still short after `MAX_WEEKS`. */
  unfinished: number;
  /** The chance (0–1) of finishing by the target date, when one is given. */
  chance: number | null;
}

export interface HowManyAnswer {
  target: string;
  /** Whole weeks between the start and the target. */
  weeks: number;
  /** Items finished in at least half / 85% / 95% of the runs. */
  p50: number;
  p85: number;
  p95: number;
  /** Runs per item count, ascending. */
  histogram: { items: number; count: number }[];
}

export interface CutLineRow {
  /** The feature's id, when one was passed in. */
  id?: string;
  name: string;
  items: number;
  /** Items up to and including this feature. */
  cumulative: number;
  weeks: WeeksAt;
  p50Date: string | null;
  p85Date: string | null;
  /** Likely done (85% of runs) by the target; null without a target. */
  inByTarget: boolean | null;
}

export interface CutLine {
  target: string | null;
  rows: CutLineRow[];
  /**
   * How many features sit above the line: done by the target in 85% of the
   * runs. They are always the first ones (the dates go up the list). Null
   * without a target.
   */
  above: number | null;
}

export interface ThroughputForecastInput {
  /** Items finished per week, oldest first. */
  samples: readonly number[];
  /** Items to finish for "When will N items be done?". */
  items?: number | null;
  /** The first day of the forecast (YYYY-MM-DD). */
  start: string;
  /** The date stakeholders ask about, for "How many by then?" and the cut line. */
  target?: string | null;
  /** Features in order, for the cut line: one row each (an item count that isn't 1 or more counts as 0). */
  features?: readonly { id?: string; name: string; items: number }[];
  iterations?: number;
  seed?: number | string;
}

export interface ThroughputForecast {
  /** Weeks of history used. */
  weeksUsed: number;
  /** Enough history for a forecast (MIN_WEEKS weeks, at least one with a finish). */
  enough: boolean;
  /** Why not, when not. */
  notEnough: "few-weeks" | "nothing-finished" | null;
  /** Items per week on average, to one decimal; null without history. */
  average: number | null;
  when: WhenAnswer | null;
  howMany: HowManyAnswer | null;
  cutLine: CutLine | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function countsHistogram(values: ArrayLike<number>): { value: number; count: number }[] {
  const counts = new Map<number, number>();
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isFinite(v)) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([value, count]) => ({ value, count }));
}

/** Items finished per run over `weeks` weeks, ascending. */
function itemsIn(
  samples: readonly number[],
  weeks: number,
  { iterations = THROUGHPUT_ITERATIONS, seed = SEED }: SimulationOptions
): Float64Array {
  const draws = usable(samples);
  const n = Math.max(1, Math.floor(iterations));
  const sums = new Float64Array(n);
  const w = Math.min(Math.floor(weeks), MAX_WEEKS);
  if (draws.length === 0 || w < 1) return sums;
  const rng = createRng(`${seed}:by-date`);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = 0; k < w; k++) sum += draws[Math.floor(rng() * draws.length)];
    sums[i] = sum;
  }
  sums.sort();
  return sums;
}

const dateAt = (start: string, w: number | null) => (w === null ? null : weekEnd(start, w));

/** The three answers from weekly throughput (see the module comment). */
export function throughputForecast(input: ThroughputForecastInput): ThroughputForecast {
  const samples = usable(input.samples);
  const opts: SimulationOptions = {
    ...(input.iterations ? { iterations: input.iterations } : {}),
    ...(input.seed !== undefined ? { seed: input.seed } : {}),
  };
  const average =
    samples.length > 0 ? round1(samples.reduce((a, b) => a + b, 0) / samples.length) : null;
  const notEnough: ThroughputForecast["notEnough"] =
    samples.length < MIN_WEEKS
      ? "few-weeks"
      : samples.every((v) => v === 0)
        ? "nothing-finished"
        : null;
  const base: ThroughputForecast = {
    weeksUsed: samples.length,
    enough: notEnough === null,
    notEnough,
    average,
    when: null,
    howMany: null,
    cutLine: null,
  };
  if (notEnough) return base;

  const target = input.target && isoDayNumber(input.target) !== null ? input.target : null;
  const targetWeeks = target ? weeksUntil(input.start, target) : null;

  const items = validItems(input.items ?? null);
  if (items !== null) {
    const runs = runThresholds([items], samples, opts);
    const sorted = runs.weeks[0];
    const weeks = weeksAt(sorted);
    let unfinished = 0;
    for (let i = 0; i < sorted.length; i++) if (!Number.isFinite(sorted[i])) unfinished++;
    base.when = {
      items,
      weeks,
      dates: {
        p50: dateAt(input.start, weeks.p50),
        p85: dateAt(input.start, weeks.p85),
        p95: dateAt(input.start, weeks.p95),
      },
      histogram: countsHistogram(sorted).map(({ value, count }) => ({ weeks: value, count })),
      unfinished,
      chance:
        targetWeeks === null ? null : Math.round(chanceWithin(sorted, targetWeeks) * 1000) / 1000,
    };
  }

  if (target && targetWeeks !== null && targetWeeks >= 1) {
    const sums = itemsIn(samples, targetWeeks, opts);
    base.howMany = {
      target,
      weeks: targetWeeks,
      p50: rankAt(sums, 50),
      // "At least X in 85% of runs" is the 15th percentile of what runs finish.
      p85: rankAt(sums, 15),
      p95: rankAt(sums, 5),
      histogram: countsHistogram(sums).map(({ value, count }) => ({ items: value, count })),
    };
  }

  // Every feature keeps its row, so a row is never read against another
  // feature: one with nothing left adds 0 and is done with the ones before it.
  const features = (input.features ?? []).slice(0, FEATURES_MAX).map((f) => ({
    ...f,
    items: validItems(f.items) ?? 0,
  }));
  if (features.length > 0) {
    const cumulative: number[] = [];
    let sum = 0;
    for (const f of features) {
      sum += f.items;
      cumulative.push(sum);
    }
    const runs = runThresholds(cumulative, samples, { ...opts, seed: `${opts.seed ?? SEED}:cut` });
    const rows: CutLineRow[] = features.map((f, k) => {
      const weeks = weeksAt(runs.weeks[k]);
      return {
        ...(f.id !== undefined ? { id: f.id } : {}),
        name: f.name,
        items: f.items,
        cumulative: cumulative[k],
        weeks,
        p50Date: dateAt(input.start, weeks.p50),
        p85Date: dateAt(input.start, weeks.p85),
        inByTarget: targetWeeks === null ? null : weeks.p85 !== null && weeks.p85 <= targetWeeks,
      };
    });
    base.cutLine = {
      target,
      rows,
      above: targetWeeks === null ? null : rows.filter((r) => r.inByTarget).length,
    };
  }
  return base;
}

/** "3 items a week", "1 item a week". */
export function perWeekText(n: number): string {
  return `${round1(n)} ${round1(n) === 1 ? "item" : "items"} a week`;
}
