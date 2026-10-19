/**
 * The cycle-time histogram and scatter plot in words: one-sentence summaries
 * and the plotted data as tables, built from the data the charts draw.
 */

import { fmt, plural, type ChartText } from "@/lib/charts/chart-text";
import type { CycleStats, HistogramDatum, ScatterDatum } from "./types";

const days = (n: number) => plural(n, "day");

export function histogramText(
  bars: readonly HistogramDatum[],
  stats: Pick<CycleStats, "median" | "p85">,
  p95: number
): ChartText {
  const total = bars.reduce((s, b) => s + b.count, 0);
  let summary: string;
  if (total === 0) {
    summary = "No items with a cycle time yet.";
  } else {
    // The tallest bar; the first one wins a tie.
    const mode = bars.reduce((best, b) => (b.count > best.count ? b : best), bars[0]);
    summary = `${plural(total, "item")}: half finished within ${days(stats.median)}, 85% within ${fmt(
      stats.p85
    )} and 95% within ${fmt(p95)}; the most common range is ${mode.bucket} (${plural(
      mode.count,
      "item"
    )}).`;
  }

  return {
    summary,
    table: {
      caption: "Items by cycle time",
      columns: ["Cycle time", "Items"],
      rows: bars.map((b) => [b.bucket, b.count]),
    },
  };
}

export function scatterText(
  points: readonly ScatterDatum[],
  stats: Pick<CycleStats, "median" | "p85">
): ChartText {
  let summary: string;
  if (points.length === 0) {
    summary = "No items with a cycle time yet.";
  } else {
    const values = points.map((p) => p.cycleTime);
    const min = Math.min(...values);
    const max = Math.max(...values);
    summary =
      points.length === 1
        ? `One item, with a cycle time of ${days(values[0])}.`
        : `Cycle times of ${plural(points.length, "item")}, in the order added, range from ${fmt(
            min
          )} to ${days(max)}; the median is ${days(stats.median)} and 85% took ${days(
            stats.p85
          )} or less.`;
  }

  return {
    summary,
    table: {
      caption: "Cycle time of each item, in the order added",
      columns: ["Item #", "Item", "Cycle time (days)"],
      rows: points.map((p) => [p.idx, p.name.trim() || "Untitled", p.cycleTime]),
    },
  };
}
