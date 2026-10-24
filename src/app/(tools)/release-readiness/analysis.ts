/**
 * Release Readiness: the charts' data and their text alternatives, and the
 * advanced statistics over ships (a p-chart of the gate-pass rate and a
 * Mann-Kendall trend), each behind its minimum sample. Pure, so the page
 * builds a chart's summary and table without loading Recharts.
 */

import type { ShipEvent, ReleaseStats } from "@/lib/releases/model";
import { pChartLimits } from "@/lib/analytics/control-chart";
import { mannKendall, type MannKendallResult } from "@/lib/analytics/trend-test";
import { enoughData } from "@/lib/analytics/min-sample";
import { fmt, plural, type ChartText } from "@/lib/charts/chart-text";
import { dayLabel } from "./text";

/** The most recent ships the pass-rate chart reads. */
export const PASS_SERIES_CAP = 20;

export interface SkippedRow {
  gateId: string;
  label: string;
  skipped: number;
  of: number;
}

/** Each gate's skips with its label, most skipped first. */
export function skippedRows(
  stats: ReleaseStats,
  labelOf: (gateId: string) => string
): SkippedRow[] {
  return stats.skippedByGate.map((g) => ({ ...g, label: labelOf(g.gateId) }));
}

export function skippedChartText(rows: readonly SkippedRow[]): ChartText {
  const skipped = rows.filter((r) => r.skipped > 0);
  const summary =
    skipped.length === 0
      ? "No gate was open at any ship."
      : `${skipped[0].label} was open at ${skipped[0].skipped} of ${plural(skipped[0].of, "ship")}${
          skipped.length > 1
            ? `; ${skipped.length - 1} other ${skipped.length === 2 ? "gate was" : "gates were"} skipped at least once`
            : ""
        }.`;
  return {
    summary,
    table: {
      columns: ["Gate", "Open at ship", "Ships it applied to"],
      rows: rows.map((r) => [r.label, r.skipped, r.of]),
    },
  };
}

export interface PassPoint {
  /** "v3.4, 24 Oct". */
  label: string;
  shippedDate: string;
  passed: number;
  total: number;
  passRatePct: number;
}

/** The gate-pass rate of each ship, oldest first, the latest `PASS_SERIES_CAP`. */
export function passSeries(events: readonly ShipEvent[]): PassPoint[] {
  return events
    .filter((e) => e.gatesTotal > 0)
    .slice(-PASS_SERIES_CAP)
    .map((e) => {
      const passed = Math.max(0, e.gatesTotal - e.gatesOpen);
      return {
        label: `${e.name}, ${dayLabel(e.shippedDate)}`,
        shippedDate: e.shippedDate,
        passed,
        total: e.gatesTotal,
        passRatePct: (passed / e.gatesTotal) * 100,
      };
    });
}

export interface PassControl {
  centerLinePct: number;
  uclPct: number;
  lclPct: number;
}

/** p-chart limits on the pass rate; null below the change-point sample. */
export function passControl(series: readonly PassPoint[]): PassControl | null {
  if (!enoughData(series.length, "changePoint")) return null;
  const limits = pChartLimits(
    series.map((s) => s.passed),
    series.map((s) => s.total)
  );
  return {
    centerLinePct: limits.centerLine * 100,
    uclPct: limits.ucl * 100,
    lclPct: limits.lcl * 100,
  };
}

/** A direction of travel in the pass rate; null below the trend sample. */
export function passTrend(series: readonly PassPoint[]): MannKendallResult | null {
  if (!enoughData(series.length, "trend")) return null;
  return mannKendall(series.map((s) => s.passRatePct));
}

export function passChartText(series: readonly PassPoint[], control: PassControl): ChartText {
  const out = series.filter(
    (s) => s.passRatePct < control.lclPct || s.passRatePct > control.uclPct
  );
  const last = series[series.length - 1];
  const summary = `Gate-pass rate across ${plural(series.length, "ship")} averages ${fmt(
    control.centerLinePct,
    0
  )}%; the latest, ${last.label}, passed ${fmt(last.passRatePct, 0)}%. ${
    out.length === 0
      ? "Every ship is inside the control limits."
      : `${plural(out.length, "ship")} ${out.length === 1 ? "is" : "are"} outside the control limits.`
  }`;
  return {
    summary,
    table: {
      columns: ["Ship", "Gates passed", "Pass rate"],
      rows: series.map((s) => [s.label, `${s.passed} of ${s.total}`, `${fmt(s.passRatePct, 0)}%`]),
    },
  };
}

/** One line on the trend: "No significant change" or which way it moves. */
export function trendSentence(trend: MannKendallResult): string {
  if (!trend.significant) return "No significant trend in the gate-pass rate.";
  return `The gate-pass rate is trending ${trend.trend === "up" ? "up" : "down"} (Mann-Kendall p = ${fmt(
    trend.pValue,
    3
  )}).`;
}
