/**
 * The colour of each stage band and the time axis's date labels, kept out
 * of charts.tsx so the page's column list can use them without loading
 * Recharts.
 */

import { chartTheme } from "@/components/charts/chart-theme";
import { isoFromDayNumber } from "@/lib/sprints/calendar";
import type { FlowStage } from "@/lib/flow";

const { colors } = chartTheme;

/**
 * Theme colours for the stages that aren't done, in board order: the
 * first queue in the axis grey, then the series colours. Done is always
 * green. A column's stored hex colour (older versions saved one) is never
 * used: it ignored the theme and was unreadable in light mode.
 */
const STAGE_COLORS = [
  chartTheme.axisColor,
  colors.cyan,
  colors.magenta,
  colors.amber,
  colors.purple,
  colors.blue,
  colors.red,
];

/** The colour of each stage, by position (the legend and the column list share it). */
export function stageColors(stages: readonly Pick<FlowStage, "kind">[]): string[] {
  let n = 0;
  return stages.map((s) =>
    s.kind === "done" ? colors.green : STAGE_COLORS[n++ % STAGE_COLORS.length]
  );
}

/** "5 Oct" for a day number on the time axis. */
export function shortDay(n: number): string {
  const iso = isoFromDayNumber(n);
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
