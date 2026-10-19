/**
 * The DORA trend chart in words: a one-sentence summary and the four plotted
 * series as a table, both built from the rows the chart draws.
 */

import { cell, fmt, listAnd, move, type ChartText } from "@/lib/charts/chart-text";
import type { DoraTrendRow } from "./charts";

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
