/**
 * The stage chart in words, and the numbers both the chart and the
 * comparison table show. Built from the same ordered stages the cards
 * render, through lib/value-stream/summary.
 */

import { cell, fmt, plural, type ChartText } from "@/lib/charts/chart-text";
import type { ValueStreamStage } from "@/lib/stores/workspace-types";
import {
  accuracyOf,
  bottleneck,
  leadOf,
  processOf,
  vsmSummary,
  waitOf,
  type StateComparison,
} from "@/lib/value-stream/summary";

/** One bar: a stage's work and wait, in days. */
export interface StageBar {
  id: string;
  name: string;
  process: number;
  wait: number;
}

export function stageBars(stages: readonly ValueStreamStage[]): StageBar[] {
  return stages.map((s) => ({
    id: s.id,
    name: s.name.trim() || "Unnamed stage",
    process: processOf(s),
    wait: waitOf(s),
  }));
}

const days = (n: number) => plural(n, "day");

export function stageChartText(stages: readonly ValueStreamStage[], mapLabel: string): ChartText {
  const s = vsmSummary(stages);
  const b = bottleneck(stages);
  let summary: string;
  if (stages.length === 0) {
    summary = "No stages yet.";
  } else {
    const waiting = `${fmt(s.totalWait)} of the ${days(s.totalLead)} across ${plural(
      stages.length,
      "stage"
    )} are waiting`;
    summary = b
      ? `${b.stage.name.trim() || "An unnamed stage"} waits longest: ${fmt(b.waitDays)} of its ${days(
          leadOf(b.stage)
        )}; ${waiting}.`
      : `${waiting[0].toUpperCase()}${waiting.slice(1)}.`;
  }
  return {
    summary,
    table: {
      caption: `${mapLabel}: work and wait per stage, in days`,
      columns: ["Stage", "Process (days)", "Wait (days)", "Lead (days)", "%C/A"],
      rows: stages.map((st) => [
        st.name.trim() || "Unnamed stage",
        cell(processOf(st)),
        cell(waitOf(st)),
        cell(leadOf(st)),
        cell(accuracyOf(st), 0),
      ]),
    },
  };
}

/** One row of the comparison: a measure, current, future and the change, formatted. */
export interface ComparisonRow {
  key: string;
  measure: string;
  current: string;
  future: string;
  change: string;
  /** Whether the change is an improvement (shorter, more efficient); null for no change. */
  better: boolean | null;
}

const dayText = (n: number) => `${fmt(n)} d`;
const pctText = (n: number | null) => (n === null ? "—" : `${fmt(n, 0)}%`);

function signed(n: number, unit: string, digits = 1): string {
  const v = fmt(n, digits);
  if (v === "0") return "No change";
  return `${n > 0 ? "+" : ""}${v}${unit}`;
}

/** Lead, process, wait, flow efficiency and rolled %C/A, current against future. */
export function comparisonRows(c: StateComparison): ComparisonRow[] {
  const better = (n: number | null, lowerIsBetter: boolean): boolean | null =>
    n === null || Math.abs(n) < 0.05 ? null : lowerIsBetter ? n < 0 : n > 0;
  return [
    {
      key: "lead",
      measure: "Lead time",
      current: dayText(c.current.totalLead),
      future: dayText(c.future.totalLead),
      change: signed(c.leadDelta, " d"),
      better: better(c.leadDelta, true),
    },
    {
      key: "process",
      measure: "Process time",
      current: dayText(c.current.totalProcess),
      future: dayText(c.future.totalProcess),
      change: signed(c.processDelta, " d"),
      better: null,
    },
    {
      key: "wait",
      measure: "Wait time",
      current: dayText(c.current.totalWait),
      future: dayText(c.future.totalWait),
      change: signed(c.waitDelta, " d"),
      better: better(c.waitDelta, true),
    },
    {
      key: "flow",
      measure: "Flow efficiency",
      current: pctText(c.current.flowEfficiency),
      future: pctText(c.future.flowEfficiency),
      change: c.flowEfficiencyDelta === null ? "—" : signed(c.flowEfficiencyDelta, " pts", 0),
      better: better(c.flowEfficiencyDelta, false),
    },
    {
      key: "ca",
      measure: "Rolled %C/A",
      current: pctText(c.current.rolledCA),
      future: pctText(c.future.rolledCA),
      change: c.rolledCADelta === null ? "—" : signed(c.rolledCADelta, " pts", 0),
      better: better(c.rolledCADelta, false),
    },
  ];
}
