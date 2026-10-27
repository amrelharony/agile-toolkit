/**
 * Risk Register: the numbers behind the matrix, the "Open risks over time"
 * chart and "Advanced analysis". Pure. The time to mitigate is
 * lib/risks/model riskTimeToClose, which the agent reads too.
 *
 * Every rating, level, age and close date comes from lib/risks/model (the
 * one reading the agent, the hand-off and the next steps use) and every
 * week from lib/analytics/periods; this module only arranges them. A
 * reopened risk keeps the day it was first closed, but only `closedOn`
 * (resolvedAt while the status is closed) counts as closed here, so it
 * reads as open again in the chart and the time to mitigate. A closed
 * risk with no close day (closed through the old generic CRUD, or an
 * agent's write before Phase 8) is left out of both, as an accepted one
 * is, and the chart says how many: counted open in every week, it would
 * disagree with the matrix and the KPIs, which read it as closed.
 */

import { cusum } from "@/lib/analytics/changepoint";
import { forecastBayesianHolt } from "@/lib/analytics/forecasting-bayesian";
import { enoughData } from "@/lib/analytics/min-sample";
import { periodBounds, periodLabel, periodRange } from "@/lib/analytics/periods";
import { mannKendall } from "@/lib/analytics/trend-test";
import { fmt, listAnd, type ChartText } from "@/lib/charts/chart-text";
import { closedOn, isActiveRisk, isClosedUndated, residualScore, toScale } from "@/lib/risks/model";
import { isIsoDate } from "@/lib/sprints/calendar";
import type { Risk } from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";

/** The weeks the chart and the statistics read: the latest half year. */
export const WEEK_CAP = 26;

/** Fewer weeks than this and the chart is a point or two: the verdict says it better. */
export const CHART_MIN_WEEKS = 3;

/** How far ahead the forecast in "Advanced analysis" looks, in weeks. */
export const FORECAST_WEEKS = 4;

/**
 * The risks the page's numbers read: the team's own while there are any
 * (the example's are listed but not counted, as the agent and the next
 * steps leave them out), else the example's, so a loaded example shows
 * its own verdict, matrix and chart. lib/risks leaves example ids out of
 * every count by default, so the page reads these rows with
 * `{ includeExamples: true }`: they never mix the example's in with the
 * team's own.
 */
export function countedRisks(records: readonly Risk[]): Risk[] {
  const real = records.filter((r) => !isExampleId(r.id));
  return real.length > 0 ? real : [...records];
}

/**
 * The risks the Markdown and the CSV list: the same set countedRisks
 * counts, so an export never mixes the example's made-up rows in with the
 * numbers it quotes (it goes to a steering group).
 */
export const exportedRisks = countedRisks;

/** Closed with no close day (lib/risks/model): the weekly series and the time to mitigate leave it out. */
export { isClosedUndated };

/** How many of `risks` are closed with no close day (isClosedUndated). */
export const closedUndatedCount = (risks: readonly Risk[]): number =>
  risks.filter(isClosedUndated).length;

/** The "YYYY-MM-DD" a stored date starts with when it is a real day. */
function dayOf(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const day = v.slice(0, 10);
  return isIsoDate(day) ? day : undefined;
}

/* ── The matrix ────────────────────────────────────────────────────────── */

export type MatrixView = "now" | "after";

/**
 * Active risks per cell, [probability − 1][impact − 1]: by the current
 * rating ("now"), or by the rating after mitigation ("after"), where a
 * risk not assessed yet isn't placed at all (never at a default) and is
 * counted in `unassessed` instead.
 */
export function riskMatrix(
  risks: readonly Risk[],
  view: MatrixView
): { grid: number[][]; placed: number; unassessed: number } {
  const grid = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => 0));
  let placed = 0;
  let unassessed = 0;
  for (const r of risks) {
    if (!isActiveRisk(r)) continue;
    const p = toScale(view === "now" ? r.probability : r.residualProbability);
    const i = toScale(view === "now" ? r.impact : r.residualImpact);
    if (view === "after" && residualScore(r) === null) {
      unassessed += 1;
      continue;
    }
    // A stored rating that isn't a number reads as 1, as riskScore reads it.
    grid[(p ?? 1) - 1][(i ?? 1) - 1] += 1;
    placed += 1;
  }
  return { grid, placed, unassessed };
}

/* ── Open risks per week ───────────────────────────────────────────────── */

export interface WeekPoint {
  /** "2026-W42". */
  period: string;
  /** Its Monday and Sunday. */
  from: string;
  to: string;
  /** Risks raised that week. */
  raised: number;
  /** Risks raised by the week's end and not closed by then (accepted ones left out). */
  open: number;
}

/**
 * Raised per week and still open at each week's end, from the first week a
 * risk was raised to this week, at most the latest WEEK_CAP weeks, with
 * quiet weeks kept. An accepted risk is left out of "open": the team chose
 * not to mitigate it, as the matrix leaves it out (the day it was accepted
 * isn't recorded, so it is left out of every week). A closed risk with no
 * close day is left out of "open" the same way (isClosedUndated); both
 * still count in the week they were raised.
 */
export function weeklyRiskSeries(risks: readonly Risk[], today: string): WeekPoint[] {
  const now = dayOf(today);
  if (!now) return [];
  const rows = risks.flatMap((r) => {
    const raised = dayOf(r.raisedAt);
    const uncounted = r.status === "accepted" || isClosedUndated(r);
    return raised ? [{ raised, closed: closedOn(r), uncounted }] : [];
  });
  if (rows.length === 0) return [];
  // A reduce, not Math.min(...), so a very long register can't overflow the stack.
  const earliest = rows.reduce((min, r) => (r.raised < min ? r.raised : min), now);
  return periodRange(earliest, now, "week", WEEK_CAP).flatMap((period) => {
    const bounds = periodBounds(period);
    if (!bounds) return [];
    let raised = 0;
    let open = 0;
    for (const r of rows) {
      if (r.raised >= bounds.from && r.raised <= bounds.to) raised += 1;
      if (!r.uncounted && r.raised <= bounds.to && !(r.closed && r.closed <= bounds.to)) open += 1;
    }
    return [{ period, from: bounds.from, to: bounds.to, raised, open }];
  });
}

/** "Week 42" for the axis; with the year for the table. */
export function weekName(point: Pick<WeekPoint, "period">, withYear = false): string {
  const label = periodLabel(point.period);
  return withYear ? label : label.replace(/,\s*\d{4}$/, "");
}

/**
 * "1 closed risk has no close day, so it isn't counted as open or in the
 * time to mitigate: give it one under its “Closed on”." Empty when none.
 */
export function undatedClosedNote(undated: number): string {
  if (undated <= 0) return "";
  return undated === 1
    ? "1 closed risk has no close day, so it isn't counted as open or in the time to mitigate: give it one under its “Closed on”."
    : `${undated} closed risks have no close day, so they aren't counted as open or in the time to mitigate: give each one under its “Closed on”.`;
}

/**
 * The chart's one-sentence summary and its rows as a table; the `undated`
 * closed risks with no close day (left out of "open") are named after it.
 */
export function weeklyChartText(points: readonly WeekPoint[], undated = 0): ChartText {
  const table = {
    columns: ["Week", "Raised", "Open at week end"],
    rows: points.map((p) => [weekName(p, true), p.raised, p.open]),
    caption: "Risks raised per week, and still open at the end of each week",
  };
  if (points.length === 0) return { summary: "No risks raised yet.", table };
  const first = points[0];
  const last = points[points.length - 1];
  const raised = points.reduce((sum, p) => sum + p.raised, 0);
  const peak = points.reduce((best, p) => (p.open > best.open ? p : best), first);
  const open =
    first.open === last.open
      ? `${last.open} open at the end of each week shown`
      : `open risks went from ${first.open} to ${last.open}`;
  const most =
    peak.open > last.open && peak !== first
      ? `, with the most (${peak.open}) in ${weekName(peak, true)}`
      : "";
  return {
    summary: `Over the last ${points.length === 1 ? "week" : `${points.length} weeks`}, ${raised} ${
      raised === 1 ? "risk was" : "risks were"
    } raised and ${open}${most}. Accepted risks aren't counted as open.${
      undated > 0 ? ` ${undatedClosedNote(undated)}` : ""
    }`,
    table,
  };
}

/* ── Advanced analysis ─────────────────────────────────────────────────── */

export interface RiskAnalysis {
  weeks: number;
  /** Null below MIN_SAMPLE.trend weeks. */
  trend: string | null;
  /** Null below MIN_SAMPLE.forecast weeks. */
  forecast: string | null;
  /** Null below MIN_SAMPLE.changePoint weeks. */
  shifts: string | null;
}

/** "More risks are being raised each week (Mann-Kendall p = 0.01)." */
export function trendSentence(raised: number[]): string {
  const t = mannKendall(raised);
  const p = t.pValue.toFixed(2);
  if (!t.significant || t.trend === "none") {
    return `No clear trend in how many risks are raised each week (Mann-Kendall p = ${p}).`;
  }
  return t.trend === "up"
    ? `More risks are being raised each week (Mann-Kendall p = ${p}).`
    : `Fewer risks are being raised each week (Mann-Kendall p = ${p}).`;
}

/** "In 4 weeks, about 5 risks still open (80% range 3–7), by a Holt forecast." */
export function forecastSentence(open: number[]): string {
  const ahead = forecastBayesianHolt(open, FORECAST_WEEKS, { priorWeight: 2 });
  const last = ahead[ahead.length - 1];
  if (!last) return "Not enough weeks to forecast the open risks.";
  const point = Math.max(0, Math.round(last.yHat));
  const low = Math.max(0, Math.round(last.lower80));
  const high = Math.max(low, Math.round(last.upper80));
  return `In ${FORECAST_WEEKS} weeks, about ${point} ${
    point === 1 ? "risk" : "risks"
  } still open (80% range ${low}–${high}), by a Holt forecast on the weekly open count.`;
}

/** "A sustained rise in open risks from Week 40 (CUSUM)." */
export function shiftSentence(points: readonly WeekPoint[]): string {
  const found = cusum(points.map((p) => p.open));
  if (found.length === 0) return "No sustained shift in the number of open risks (CUSUM).";
  const parts = found.map(
    (c) =>
      `a sustained ${c.direction === "up" ? "rise" : "drop"} in open risks from ${
        points[c.index] ? weekName(points[c.index], true) : `week ${c.index + 1}`
      }`
  );
  const text = listAnd(parts);
  return `${text.charAt(0).toUpperCase()}${text.slice(1)} (CUSUM).`;
}

export function analyseRisks(points: readonly WeekPoint[]): RiskAnalysis {
  return {
    weeks: points.length,
    trend: enoughData(points.length, "trend") ? trendSentence(points.map((p) => p.raised)) : null,
    forecast: enoughData(points.length, "forecast")
      ? forecastSentence(points.map((p) => p.open))
      : null,
    shifts: enoughData(points.length, "changePoint") ? shiftSentence(points) : null,
  };
}

/** "12 days"; "—" when there is none. */
export const daysText = (n: number | null): string =>
  n === null ? "—" : `${fmt(n, 0)} ${n === 1 ? "day" : "days"}`;
