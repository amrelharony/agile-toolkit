/**
 * The advanced statistics on a burn: Holt's forecast of the rest of the
 * sprint, the days CUSUM sees the pace shift, and (Burnup) a Mann-Kendall
 * trend test. They fit the working-day samples of the burn the page shows
 * (the board's, else the typed log's), so a weekend's flat run doesn't read
 * as a stall, and each runs only from its minimum sample (MIN_SAMPLE).
 * Shared by Burndown and Burnup. Pure.
 */

import { cusum } from "@/lib/analytics/changepoint";
import { forecastBayesianHolt } from "@/lib/analytics/forecasting-bayesian";
import { enoughData } from "@/lib/analytics/min-sample";
import { mannKendall, type MannKendallResult } from "@/lib/analytics/trend-test";
import { cell, fmt, plural, NO_VALUE, type ChartText } from "@/lib/charts/chart-text";
import type { BurnSeries } from "@/lib/sprints/burn";
import type { ForecastChartRow } from "./charts";

export type BurnPick = "remaining" | "done";

export interface BurnSample {
  day: number;
  value: number;
}

/**
 * The value at the end of each working day up to the last day read, with
 * day 0 (the starting point) always first. A log day without a reading
 * carries the one before it.
 */
export function workingSamples(burn: BurnSeries, pick: BurnPick): BurnSample[] {
  if (burn.lastDay === null) return [];
  const out: BurnSample[] = [];
  let carry: number | null = null;
  for (const d of burn.days) {
    if (d.day > burn.lastDay) break;
    const v = d[pick];
    if (typeof v === "number") carry = v;
    if (carry === null) continue;
    if (d.day === 0 || d.working) out.push({ day: d.day, value: carry });
  }
  return out;
}

export interface BurnAnalysis {
  /** Working days sampled. */
  samples: BurnSample[];
  /** The forecast's rows (samples, then the working days still to come); empty below the minimum. */
  rows: ForecastChartRow[];
  /** Days CUSUM saw the pace shift (only from MIN_SAMPLE.changePoint samples). */
  shifts: Array<{ day: number; direction: "up" | "down" }>;
  /** The trend test (only from MIN_SAMPLE.trend samples, when asked for). */
  trend: MannKendallResult | null;
  forecastReady: boolean;
  shiftsReady: boolean;
  trendReady: boolean;
  /** Working days left after the last day read: the forecast's horizon. */
  horizon: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Holt, CUSUM and (with `trend`) Mann-Kendall on the burn's working-day samples. */
export function burnAnalysis(
  burn: BurnSeries,
  pick: BurnPick,
  { trend: withTrend = false }: { trend?: boolean } = {}
): BurnAnalysis {
  const samples = workingSamples(burn, pick);
  const values = samples.map((s) => s.value);
  const n = samples.length;
  const ahead =
    burn.lastDay === null
      ? []
      : burn.days.filter((d) => d.day > (burn.lastDay as number) && d.working).map((d) => d.day);
  const forecastReady = enoughData(n, "forecast");
  const shiftsReady = enoughData(n, "changePoint");
  const trendReady = withTrend && enoughData(n, "trend");

  const rows: ForecastChartRow[] = [];
  if (forecastReady) {
    for (const s of samples) rows.push({ day: s.day, actual: s.value, forecast: null, band: null });
    // Points left can't go below 0, and points done can't pass the scope.
    const cap = pick === "done" ? burn.scopeNow : Number.POSITIVE_INFINITY;
    const clamp = (v: number) => round1(Math.min(cap, Math.max(0, v)));
    forecastBayesianHolt(values, ahead.length).forEach((fp, i) => {
      rows.push({
        day: ahead[i],
        actual: null,
        forecast: clamp(fp.yHat),
        band: [clamp(fp.lower80), clamp(fp.upper80)],
      });
    });
  }
  const shifts = shiftsReady
    ? cusum(values).map((cp) => ({ day: samples[cp.index]?.day ?? 0, direction: cp.direction }))
    : [];
  return {
    samples,
    rows,
    shifts,
    trend: trendReady ? mannKendall(values) : null,
    forecastReady,
    shiftsReady,
    trendReady,
    horizon: ahead.length,
  };
}

/** The forecast chart in words: where it ends, the shifts, and the rows as a table. */
export function forecastText(analysis: BurnAnalysis, pick: BurnPick): ChartText {
  const what = pick === "remaining" ? "points left" : "points done";
  const last = analysis.rows[analysis.rows.length - 1];
  let summary: string;
  if (!analysis.forecastReady) {
    summary = `Not enough working days for a forecast yet.`;
  } else if (analysis.horizon === 0 || !last || last.forecast === null) {
    summary = `No working days left to forecast; ${plural(analysis.samples.length, "working day")} sampled.`;
  } else {
    const band = last.band ? ` (80% range ${fmt(last.band[0])}–${fmt(last.band[1])})` : "";
    summary = `Holt's forecast from ${plural(analysis.samples.length, "working day")}: about ${fmt(
      last.forecast
    )} ${what} on day ${last.day}${band}.`;
  }
  if (analysis.shifts.length > 0) {
    summary += ` CUSUM sees the pace shift around ${analysis.shifts
      .map((s) => `day ${s.day} (${s.direction})`)
      .join(", ")}.`;
  }
  return {
    summary,
    table: {
      caption: `Forecast of the ${what} by sprint day`,
      columns: [
        "Day",
        pick === "remaining" ? "Points left" : "Points done",
        "Forecast",
        "80% range",
      ],
      rows: analysis.rows.map((r) => [
        r.day,
        cell(r.actual),
        cell(r.forecast),
        r.band ? `${fmt(r.band[0])}–${fmt(r.band[1])}` : NO_VALUE,
      ]),
    },
  };
}
