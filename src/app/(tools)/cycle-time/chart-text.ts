/**
 * The cycle-time histogram and scatter plot in words: one-sentence summaries
 * and the plotted data as tables, built from the data the charts draw.
 */

import { fmt, plural, type ChartText } from "@/lib/charts/chart-text";
import type { HistogramDatum, ScatterDatum } from "./types";
import { SOURCE_LABEL } from "./helpers";

const days = (n: number) => plural(n, "day");

/** The percentiles a summary quotes; null until there are enough items. */
export interface QuotedPercentiles {
  median: number | null;
  p85: number | null;
  p95: number | null;
}

export function histogramText(
  bars: readonly HistogramDatum[],
  stats: QuotedPercentiles
): ChartText {
  const total = bars.reduce((s, b) => s + b.count, 0);
  let summary: string;
  if (total === 0) {
    summary = "No items with a cycle time yet.";
  } else {
    // The tallest bar; the first one wins a tie.
    const mode = bars.reduce((best, b) => (b.count > best.count ? b : best), bars[0]);
    const spread =
      stats.median !== null && stats.p85 !== null && stats.p95 !== null
        ? `half finished within ${days(stats.median)}, 85% within ${fmt(stats.p85)} and 95% within ${fmt(
            stats.p95
          )}; `
        : "";
    summary = `${plural(total, "item")}: ${spread}the most common range is ${mode.bucket} (${plural(
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

/**
 * The scatter in words. `shifts` are the change points drawn on it (from
 * Advanced analysis' sample floor): the summary names them too, so the
 * text says what the lines on the plot say.
 */
export function scatterText(
  points: readonly ScatterDatum[],
  stats: QuotedPercentiles,
  shifts: readonly { detail: string }[] = []
): ChartText {
  let summary: string;
  if (points.length === 0) {
    summary = "No items with a cycle time yet.";
  } else {
    const values = points.map((p) => p.cycleTime);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const first = points[0].doneOn;
    const last = points[points.length - 1].doneOn;
    const quoted =
      stats.median !== null && stats.p85 !== null
        ? `; the median is ${days(stats.median)} and 85% took ${days(stats.p85)} or less`
        : "";
    summary =
      points.length === 1
        ? `One item, finished on ${first}, with a cycle time of ${days(values[0])}.`
        : `Cycle times of ${plural(points.length, "item")} finished from ${first} to ${last}, in order of completion, range from ${fmt(
            min
          )} to ${days(max)}${quoted}.`;
    if (shifts.length > 0) {
      summary = `${summary} Marked on the chart: ${shifts.map((s) => s.detail).join(" ")}`;
    }
  }

  return {
    summary,
    table: {
      caption: "Cycle time of each item, in order of completion",
      columns: ["Finished", "Item", "Source", "Cycle time (days)"],
      rows: points.map((p) => [
        p.doneOn,
        p.name.trim() || "Untitled",
        SOURCE_LABEL[p.source],
        p.cycleTime,
      ]),
    },
  };
}
