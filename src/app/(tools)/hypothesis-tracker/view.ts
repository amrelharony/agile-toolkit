/**
 * The Hypothesis Tracker page's reading of the list: the status filter and
 * its counts, a target in words, the rows the validation rate counts, and
 * the time to learn behind "Advanced analysis". Every number comes from
 * lib/hypotheses (the agent actions read it too) or lib/analytics; this
 * file only arranges it for the page, its export and its tests.
 */

import type { Hypothesis, HypothesisStatus, HypothesisTarget } from "@/lib/stores/workspace-types";
import { durationsFromTimeRanges, kaplanMeier, medianSurvivalTime } from "@/lib/analytics/survival";
import { enoughData } from "@/lib/analytics/min-sample";
import type { ChartTable } from "@/lib/charts/chart-text";
import {
  formatMetric,
  isResolved,
  missingFields,
  validationRate,
  type MissingField,
  type ValidationRate,
} from "@/lib/hypotheses/model";
import { EXAMPLE_ID_PREFIX, isExampleId } from "@/lib/utils/example-id";

export const STATUS_LABEL: Record<HypothesisStatus, string> = {
  drafted: "Drafted",
  running: "Running",
  validated: "Validated",
  invalidated: "Invalidated",
  inconclusive: "Inconclusive",
};

/** A status as the page shows it; an unknown stored one reads as itself. */
export const statusLabel = (s: string) => STATUS_LABEL[s as HypothesisStatus] ?? s;

/** What a hand-off draft still needs, in the page's words. */
export const MISSING_LABEL: Record<MissingField, string> = {
  willDo: "what we'll do",
  successMetric: "the success metric",
};

export const missingText = (fields: readonly MissingField[]) =>
  fields.map((f) => MISSING_LABEL[f]).join(" and ");

/* ── The status filter ───────────────────────────────────────────────── */

export type StatusFilter =
  | "all"
  | "open"
  | "validated"
  | "invalidated"
  | "inconclusive"
  | "needs-detail";

/** The filter's options, in order. "Open" is drafted or running: no result yet. */
export const STATUS_FILTERS: readonly (readonly [StatusFilter, string])[] = [
  ["all", "All"],
  ["open", "Open"],
  ["validated", "Validated"],
  ["invalidated", "Invalidated"],
  ["inconclusive", "Inconclusive"],
  ["needs-detail", "Needs detail"],
];

export function matchesFilter(h: Hypothesis, filter: StatusFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "open":
      return !isResolved(h.status);
    case "needs-detail":
      return missingFields(h).length > 0;
    default:
      return h.status === filter;
  }
}

/** How many rows each option shows, for its label: "Open (3)". */
export function filterCounts(list: readonly Hypothesis[]): Record<StatusFilter, number> {
  const counts = Object.fromEntries(STATUS_FILTERS.map(([f]) => [f, 0])) as Record<
    StatusFilter,
    number
  >;
  for (const h of list) {
    for (const [f] of STATUS_FILTERS) if (matchesFilter(h, f)) counts[f] += 1;
  }
  return counts;
}

/* ── Target ──────────────────────────────────────────────────────────── */

/** "at least 12% (from 10%)", "at most 3 days". */
export function targetText(t: HypothesisTarget): string {
  const bound = t.direction === "decrease" ? "at most" : "at least";
  const from =
    typeof t.baseline === "number" && Number.isFinite(t.baseline)
      ? ` (from ${formatMetric(t.baseline, t.unit)})`
      : "";
  return `${bound} ${formatMetric(t.value, t.unit)}${from}`;
}

/* ── What the rate counts ────────────────────────────────────────────── */

export interface Counted {
  rows: Hypothesis[];
  /** True while only the example is on the page: the numbers are the example's. */
  example: boolean;
}

/**
 * The rows the validation rate and the time to learn count: the team's own,
 * as tool.hypothesis_tracker counts them. While the tracker holds only the
 * example, the example's rows are counted instead, so "Load an example"
 * shows a filled-in verdict; lib/hypotheses' validationRate leaves example
 * ids out, so they are read without the prefix here.
 */
export function countedRows(list: readonly Hypothesis[]): Counted {
  const real = list.filter((h) => !isExampleId(h.id));
  if (real.length > 0 || list.length === 0) return { rows: real, example: false };
  return {
    rows: list.map((h) => ({ ...h, id: h.id.slice(EXAMPLE_ID_PREFIX.length) })),
    example: true,
  };
}

export const rateOf = (counted: Counted): ValidationRate => validationRate(counted.rows);

/** "60%", or "—" while no result is decisive (never 0%). */
export const rateText = (r: ValidationRate) =>
  r.rate === null ? "—" : `${Math.round(r.rate * 100)}%`;

/* ── Time to learn (Advanced analysis) ───────────────────────────────── */

export interface TimeToLearn {
  /** Hypotheses with a result and both days readable. */
  resolved: number;
  /** Enough results for the curve (MIN_SAMPLE.distribution). */
  enough: boolean;
  /** Median days from raised to result (Kaplan-Meier); null below the sample. */
  median: number | null;
  points: { t: number; survival: number }[];
  summary: string;
  table: ChartTable;
}

const DAYS = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/**
 * How long tests take to give a result: a Kaplan-Meier curve over the days
 * from raised to resolved, where a test still open counts as "not yet"
 * (censored at `now`). Only shown from MIN_SAMPLE.distribution results:
 * with fewer, one quick test makes the median.
 */
export function timeToLearn(rows: readonly Hypothesis[], now: Date): TimeToLearn {
  const obs = durationsFromTimeRanges(
    rows.map((h) => ({
      raisedAt: h.raisedAt,
      resolvedAt: isResolved(h.status) ? h.resolvedAt : undefined,
    })),
    now
  );
  const resolved = obs.filter((o) => o.event).length;
  const enough = enoughData(resolved, "distribution");
  const curve = enough ? kaplanMeier(obs) : [];
  const points = curve.map((p) => ({ t: p.t, survival: Math.round(p.survival * 1000) / 1000 }));
  const median = enough ? medianSurvivalTime(curve) : null;
  const table: ChartTable = {
    columns: ["After", "Still open"],
    rows: points.map((p) => [DAYS(p.t), `${Math.round(p.survival * 100)}%`]),
    caption: "Share of hypotheses still waiting for a result",
  };
  const summary = !enough
    ? ""
    : median === null
      ? `Over ${resolved} results, fewer than half of the tests have given a result yet.`
      : `Half of the tests gave a result within ${DAYS(median)} (over ${resolved} results; open ones count as still waiting).`;
  return { resolved, enough, median, points, summary, table };
}
