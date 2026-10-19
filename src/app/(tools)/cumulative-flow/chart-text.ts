/**
 * The cumulative flow and WIP control charts in words: one-sentence summaries
 * and the plotted series as tables, built from the data the charts draw.
 */

import { fmt, move, plural, type ChartText } from "@/lib/charts/chart-text";
import type { StatusColumn, WipSeriesPoint, WipSignal } from "./types";

type FlowRow = Record<string, string | number>;

const count = (row: FlowRow, name: string): number => {
  const v = row[name];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
};

export function flowChartText(
  rows: readonly FlowRow[],
  columns: readonly StatusColumn[]
): ChartText {
  let summary: string;
  const done = columns[columns.length - 1];
  if (rows.length === 0 || !done) {
    summary = "No snapshots yet.";
  } else {
    const first = rows[0];
    const last = rows[rows.length - 1];
    const total = columns.reduce((s, c) => s + count(last, c.name), 0);
    // In progress: every column but the first (to do) and the last (done).
    const middle = columns.length >= 3 ? columns.slice(1, -1) : [];
    const wip = middle.reduce((s, c) => s + count(last, c.name), 0);
    const wipClause = middle.length > 0 ? `; ${plural(wip, "item")} in progress` : "";
    summary =
      rows.length === 1
        ? `One snapshot on ${String(last.date)}: ${plural(total, "item")}, ${fmt(
            count(last, done.name)
          )} in ${done.name}${wipClause}.`
        : `${done.name} ${move(count(first, done.name), count(last, done.name))} items between ${String(
            first.date
          )} and ${String(last.date)}${wipClause ? `${wipClause} on the last day` : ""}.`;
  }

  return {
    summary,
    table: {
      caption: "Items in each column by date",
      columns: ["Date", ...columns.map((c) => c.name)],
      rows: rows.map((r) => [String(r.date), ...columns.map((c) => count(r, c.name))]),
    },
  };
}

export function wipChartText(
  series: readonly WipSeriesPoint[],
  signals: readonly WipSignal[],
  wipLimit: number | null
): ChartText {
  let summary: string;
  if (series.length === 0) {
    summary = "No snapshots yet.";
  } else {
    const values = series.map((p) => p.value);
    const first = values[0];
    const last = values[values.length - 1];
    const parts = [
      `WIP ${move(first, last)} over ${plural(series.length, "snapshot")}, ranging from ${fmt(
        Math.min(...values)
      )} to ${fmt(Math.max(...values))}`,
    ];
    // One point can break several rules; count it once.
    const flagged = new Set(signals.map((s) => s.index)).size;
    if (flagged > 0) parts.push(`${plural(flagged, "point")} out of control`);
    if (wipLimit !== null) {
      const over = values.filter((v) => v > wipLimit).length;
      parts.push(
        over > 0
          ? `above the WIP limit of ${fmt(wipLimit)} on ${plural(over, "snapshot")}`
          : `never above the WIP limit of ${fmt(wipLimit)}`
      );
    }
    summary = `${parts.join("; ")}.`;
  }

  return {
    summary,
    table: {
      caption: "Items in progress by date",
      columns: ["Date", "WIP"],
      rows: series.map((p) => [p.date, p.value]),
    },
  };
}
