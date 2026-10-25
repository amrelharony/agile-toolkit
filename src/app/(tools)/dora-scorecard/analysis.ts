/**
 * The DORA Scorecard's advanced statistics, as sentences: a trend test per
 * metric, and control limits and change points on deploy frequency. The old
 * page ran control limits and CUSUM from 4 quarters and the trend test from
 * 5, out in the open; a year of quarters is noise to those methods, so they
 * now wait for MIN_SAMPLE (trend: 6, change point: 8 quarters) and sit in
 * the collapsed "Advanced analysis". Pure.
 */

import { enoughData } from "@/lib/analytics/min-sample";
import { mannKendall } from "@/lib/analytics/trend-test";
import { xmrLimits } from "@/lib/analytics/control-chart";
import { cusum } from "@/lib/analytics/changepoint";
import {
  DORA_BANDS,
  DORA_METRICS,
  DORA_METRIC_LABEL,
  formatMetric,
  type DoraMetric,
} from "@/lib/dora/bands";
import { plotted, type DoraTrendRow } from "./chart-text";

export interface DoraAnalysis {
  quarters: number;
  /** One sentence per metric, from MIN_SAMPLE.trend quarters; null before. */
  trends: { metric: DoraMetric; text: string }[] | null;
  /** Deploy frequency's control limits, from MIN_SAMPLE.changePoint quarters. */
  control: string | null;
  /** Deploy frequency's change points, from MIN_SAMPLE.changePoint quarters. */
  shifts: string | null;
}

const p = (v: number) => (v < 0.001 ? "p < 0.001" : `p = ${v.toFixed(3)}`);

const stored = (metric: DoraMetric, v: number) => (metric === "changeFailRate" ? v / 100 : v);

/** mannKendall confirms a trend only from this many points (its normal approximation). */
const CONFIRMS_FROM = 10;

function trendText(metric: DoraMetric, series: number[]): string {
  const r = mannKendall(series);
  const label = DORA_METRIC_LABEL[metric];
  if (!r.significant || r.trend === "none") {
    // Below 10 points the test never confirms one, however steady: say which
    // way it leans rather than a bare "no trend" next to a small p.
    const lean =
      series.length < CONFIRMS_FROM && r.z !== 0
        ? `, leaning ${r.z > 0 ? "up" : "down"}; the test confirms a trend from ${CONFIRMS_FROM} quarters`
        : "";
    return `${label}: no confirmed trend (${p(r.pValue)})${lean}.`;
  }
  const better = DORA_BANDS.higherIsBetter[metric] ? r.trend === "up" : r.trend === "down";
  return `${label}: ${r.trend === "up" ? "rising" : "falling"} (${p(r.pValue)}), ${
    better ? "the better direction" : "the worse direction"
  }.`;
}

export function analyseDora(rows: readonly DoraTrendRow[]): DoraAnalysis {
  const n = rows.length;
  const trends = enoughData(n, "trend")
    ? DORA_METRICS.map((m) => ({
        metric: m,
        text: trendText(
          m,
          rows.map((r) => plotted(r, m))
        ),
      }))
    : null;
  if (!enoughData(n, "changePoint")) return { quarters: n, trends, control: null, shifts: null };

  const deploys = rows.map((r) => r.deployFreqPerWeek);
  const limits = xmrLimits(deploys, true);
  const show = (v: number) => formatMetric("deployFreqPerWeek", stored("deployFreqPerWeek", v));
  const outside = rows.filter(
    (r) => r.deployFreqPerWeek > limits.ucl || r.deployFreqPerWeek < limits.lcl
  );
  const control = `Deploy frequency's control limits run from ${show(limits.lcl)} to ${show(
    limits.ucl
  )} around ${show(limits.centerLine)}; ${
    outside.length === 0
      ? "no quarter falls outside them."
      : `${outside.map((r) => r.quarter).join(", ")} ${outside.length === 1 ? "falls" : "fall"} outside them.`
  }`;
  const points = cusum(deploys);
  const shifts =
    points.length === 0
      ? "CUSUM finds no lasting shift in deploy frequency."
      : `CUSUM finds ${points
          .map(
            (c) => `a ${c.direction === "up" ? "lift" : "drop"} at ${rows[c.index]?.quarter ?? "?"}`
          )
          .join(", ")} in deploy frequency.`;
  return { quarters: n, trends, control, shifts };
}
