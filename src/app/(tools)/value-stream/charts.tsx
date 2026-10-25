"use client";

// Recharts lives here so the page loads it only when the stage chart
// mounts. Import this module through next/dynamic.
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";
import type { StageBar } from "./chart-text";

const { colors } = chartTheme;

/** Height per stage row, so long maps get room instead of squeezed bars. */
const ROW_HEIGHT = 36;

/**
 * Each stage of the map in order, its lead time split into work (process)
 * and waiting: the longest amber bar is the bottleneck. Horizontal, so the
 * stage names read on a phone.
 */
export function StageTimesChart({ data }: { data: StageBar[] }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * ROW_HEIGHT + 60)}>
      {/* ChartFigure hides the plot behind its summary and table, so the SVG
          mustn't be a tab stop. */}
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 12, left: 4, bottom: 0 }}
        accessibilityLayer={false}
      >
        <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          tickLine={false}
          unit=" d"
        />
        <YAxis
          type="category"
          dataKey="name"
          width={96}
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip contentStyle={chartTheme.tooltipStyle} />
        <Legend wrapperStyle={chartTheme.legendStyle} />
        <Bar
          dataKey="process"
          name="Work (process)"
          stackId="lead"
          fill={colors.cyan}
          stroke={chartTheme.cardBackground}
          strokeWidth={2}
          maxBarSize={24}
        />
        <Bar
          dataKey="wait"
          name="Waiting"
          stackId="lead"
          fill={colors.amber}
          stroke={chartTheme.cardBackground}
          strokeWidth={2}
          maxBarSize={24}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
