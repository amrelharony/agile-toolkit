/**
 * The DORA trend chart in words: a one-sentence summary and the four plotted
 * series as a table, both built from the rows the chart draws.
 */

import { NO_VALUE, cell, fmt, listAnd, move, type ChartText } from "@/lib/charts/chart-text";
import { DORA_METRIC_LABEL, doraBand, formatMetric, type DoraMetric } from "@/lib/dora/bands";

/** One quarter's four numbers as the charts plot them (change failure as a %). */
export interface DoraTrendRow {
  quarter: string;
  deployFreqPerWeek: number;
  leadTimeHours: number;
  changeFailRatePct: number;
  mttrHours: number;
}

/** A metric's unit in a table header. */
export const METRIC_UNIT: Record<DoraMetric, string> = {
  deployFreqPerWeek: "a week",
  leadTimeHours: "hours",
  changeFailRate: "%",
  mttrHours: "hours",
};

/** The value a chart plots for `metric`: change failure as a percentage, the rest as stored. */
export function plotted(row: DoraTrendRow, metric: DoraMetric): number {
  return metric === "changeFailRate" ? row.changeFailRatePct : row[metric];
}

/** A plotted value back in the stored unit, for its band. */
const stored = (metric: DoraMetric, v: number) => (metric === "changeFailRate" ? v / 100 : v);

/**
 * One metric's chart in words: how it moved across the quarters and where
 * it stands now, and each quarter's value with its band as a table.
 *
 *   "From 2026-Q1 to 2026-Q3, lead time fell from 48 hours to 20 hours; 2026-Q3 is Elite."
 */
export function metricTrendText(metric: DoraMetric, rows: readonly DoraTrendRow[]): ChartText {
  const label = DORA_METRIC_LABEL[metric];
  const show = (v: number) => formatMetric(metric, stored(metric, v));
  let summary: string;
  if (rows.length === 0) {
    summary = "No quarters added yet.";
  } else {
    const a = rows[0];
    const b = rows[rows.length - 1];
    const now = doraBand(metric, stored(metric, plotted(b, metric)));
    const where = now ? `; ${b.quarter} is ${now}` : "";
    summary =
      rows.length === 1
        ? `${b.quarter}: ${label.toLowerCase()} ${show(plotted(b, metric))}${where}.`
        : `From ${a.quarter} to ${b.quarter}, ${label.toLowerCase()} ${move(
            plotted(a, metric),
            plotted(b, metric),
            show
          )}${where}.`;
  }
  return {
    summary,
    table: {
      caption: `${label} by quarter`,
      columns: ["Quarter", `${label} (${METRIC_UNIT[metric]})`, "Band"],
      rows: rows.map((r) => {
        const v = plotted(r, metric);
        return [
          r.quarter,
          cell(v, metric === "deployFreqPerWeek" ? 2 : 1),
          doraBand(metric, stored(metric, v)) ?? NO_VALUE,
        ];
      }),
    },
  };
}

const perWeek = (v: number) => fmt(v, 2);
const hours = (v: number) => `${fmt(v)} hours`;
const pct = (v: number) => `${fmt(v)}%`;

export function doraTrendText(rows: readonly DoraTrendRow[]): ChartText {
  let summary: string;
  if (rows.length === 0) {
    summary = "No quarters added yet.";
  } else if (rows.length === 1) {
    const q = rows[0];
    summary = `${q.quarter}: ${perWeek(q.deployFreqPerWeek)} deploys a week, ${hours(
      q.leadTimeHours
    )} lead time, a ${pct(q.changeFailRatePct)} change failure rate and ${hours(
      q.mttrHours
    )} to restore.`;
  } else {
    const a = rows[0];
    const b = rows[rows.length - 1];
    summary = `From ${a.quarter} to ${b.quarter}, ${listAnd([
      `deploys a week ${move(a.deployFreqPerWeek, b.deployFreqPerWeek, perWeek)}`,
      `lead time ${move(a.leadTimeHours, b.leadTimeHours, hours)}`,
      `change failure rate ${move(a.changeFailRatePct, b.changeFailRatePct, pct)}`,
      `time to restore ${move(a.mttrHours, b.mttrHours, hours)}`,
    ])}.`;
  }

  return {
    summary,
    table: {
      caption: "DORA metrics by quarter",
      columns: ["Quarter", "Deploys a week", "Lead time (h)", "Change failure (%)", "MTTR (h)"],
      rows: rows.map((r) => [
        r.quarter,
        cell(r.deployFreqPerWeek, 2),
        cell(r.leadTimeHours),
        cell(r.changeFailRatePct),
        cell(r.mttrHours),
      ]),
    },
  };
}
