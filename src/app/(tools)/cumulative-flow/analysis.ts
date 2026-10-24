/**
 * The statistics behind "Advanced analysis": XmR control limits, Western
 * Electric rules and CUSUM change points on the WIP series, and a
 * Mann-Kendall trend test. Each runs only from its sample floor
 * (lib/analytics/min-sample): below MIN_SAMPLE.changePoint points the
 * limits collapse toward the centre line or swing on one outlier and flag
 * every point, and below MIN_SAMPLE.trend a trend test is noise.
 */

import type { CausalAnnotationData } from "@/components/charts/causal-annotation-list";
import { xmrLimits, westernElectricRules } from "@/lib/analytics/control-chart";
import { cusum } from "@/lib/analytics/changepoint";
import { mannKendall } from "@/lib/analytics/trend-test";
import { enoughData } from "@/lib/analytics/min-sample";
import type { WipLimits, WipSeriesPoint, WipSignal } from "./types";

export interface WipAnalysis {
  /** Null below MIN_SAMPLE.changePoint points. */
  limits: WipLimits | null;
  signals: WipSignal[];
  shifts: CausalAnnotationData[];
  /** Null below MIN_SAMPLE.trend points. */
  trend: { trend: "up" | "down" | "none"; significant: boolean; pValue: number } | null;
}

export function analyseWip(series: readonly WipSeriesPoint[]): WipAnalysis {
  const values = series.map((p) => p.value);
  // WIP is a count: the lower limit is clamped at 0.
  const limits = enoughData(values.length, "changePoint") ? xmrLimits(values, true) : null;
  // Rule 1 ("beyond ±3σ") means nothing when the limits collapse onto the centre line.
  const signals =
    limits && limits.ucl > limits.centerLine ? westernElectricRules(values, limits) : [];
  const shifts: CausalAnnotationData[] = enoughData(values.length, "changePoint")
    ? cusum(values).map((cp) => {
        const point = series[cp.index];
        const up = cp.direction === "up";
        return {
          x: point?.date ?? cp.index,
          label: up ? "WIP regime up" : "WIP regime down",
          detail: `CUSUM detected a sustained ${up ? "increase" : "decrease"} in WIP at ${
            point?.date ?? `index ${cp.index}`
          }.`,
          // Signed: negative for a downward shift, so compare its size.
          confidence: Math.abs(cp.cumulativeStat) >= 6 ? "strong" : "moderate",
        };
      })
    : [];
  const mk = enoughData(values.length, "trend") ? mannKendall(values) : null;
  return {
    limits,
    signals,
    shifts,
    trend: mk ? { trend: mk.trend, significant: mk.significant, pValue: mk.pValue } : null,
  };
}

/** The trend test in a sentence, or null without one. */
export function trendSentence(trend: WipAnalysis["trend"]): string | null {
  if (!trend) return null;
  if (!trend.significant || trend.trend === "none") {
    return `No clear trend in WIP (Mann-Kendall p = ${trend.pValue.toFixed(3)}).`;
  }
  return trend.trend === "up"
    ? `WIP is trending up (Mann-Kendall p = ${trend.pValue.toFixed(3)}): more is being started than finished.`
    : `WIP is trending down (Mann-Kendall p = ${trend.pValue.toFixed(3)}).`;
}
