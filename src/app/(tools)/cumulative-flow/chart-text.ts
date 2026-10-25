/**
 * The cumulative flow and WIP control charts in words: one-sentence summaries
 * and the plotted series as tables, built from the data the charts draw.
 * Rows are keyed by stage id (a renamed column keeps its band), and the
 * stages carry their labels and kinds.
 */

import { fmt, move, plural, type ChartText } from "@/lib/charts/chart-text";
import type { FlowDay, FlowStage } from "@/lib/flow";
import type { WipSeriesPoint, WipSignal } from "./types";

const count = (day: FlowDay, id: string): number => {
  const v = day.counts[id];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
};

export function flowChartText(days: readonly FlowDay[], stages: readonly FlowStage[]): ChartText {
  let summary: string;
  const done = stages.find((s) => s.kind === "done") ?? stages[stages.length - 1];
  if (days.length === 0 || !done) {
    summary = "Nothing charted yet.";
  } else {
    const first = days[0];
    const last = days[days.length - 1];
    const total = stages.reduce((s, st) => s + count(last, st.id), 0);
    const active = stages.filter((s) => s.kind === "active");
    const wip = active.reduce((s, st) => s + count(last, st.id), 0);
    const wipClause = active.length > 0 ? `; ${plural(wip, "item")} in progress` : "";
    summary =
      days.length === 1
        ? `One day, ${last.date}: ${plural(total, "item")}, ${fmt(count(last, done.id))} in ${
            done.label
          }${wipClause}.`
        : `${done.label} ${move(count(first, done.id), count(last, done.id))} items between ${
            first.date
          } and ${last.date}${wipClause ? `${wipClause} on the last day` : ""}.`;
  }

  return {
    summary,
    table: {
      caption: "Items in each stage by date",
      columns: ["Date", ...stages.map((s) => s.label)],
      rows: days.map((d) => [d.date, ...stages.map((s) => count(d, s.id))]),
    },
  };
}

export function wipChartText(
  series: readonly WipSeriesPoint[],
  signals: readonly WipSignal[],
  wipLimit: number | null,
  unit: readonly [string, string] = ["snapshot", "snapshots"]
): ChartText {
  let summary: string;
  if (series.length === 0) {
    summary = "Nothing charted yet.";
  } else {
    const values = series.map((p) => p.value);
    const first = values[0];
    const last = values[values.length - 1];
    const points = plural(series.length, unit[0], unit[1]);
    const parts = [
      `WIP ${move(first, last)} over ${points}, ranging from ${fmt(Math.min(...values))} to ${fmt(
        Math.max(...values)
      )}`,
    ];
    // One point can break several rules; count it once.
    const flagged = new Set(signals.map((s) => s.index)).size;
    if (flagged > 0) parts.push(`${plural(flagged, "point")} out of control`);
    if (wipLimit !== null) {
      const over = values.filter((v) => v > wipLimit).length;
      parts.push(
        over > 0
          ? `above the WIP limit of ${fmt(wipLimit)} on ${plural(over, unit[0], unit[1])}`
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
