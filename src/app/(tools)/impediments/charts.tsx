"use client";

// Recharts lives here so the Impediments page loads it only when the weekly
// chart mounts. Import this module through next/dynamic.
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";

export interface WeeklyPoint {
  /** "12 Oct" */
  week: string;
  raised: number;
  open: number;
}

const { colors } = chartTheme;

/**
 * Impediments raised each week (bars) against how many were still open at
 * the week's end (line): the bars say how much new trouble arrives, the
 * line whether the team is keeping up with it.
 */
export function WeeklyImpedimentsChart({ data }: { data: WeeklyPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      {/* ChartFigure hides the plot behind its summary and table, so the SVG
          mustn't be a tab stop. */}
      <ComposedChart
        data={data}
        margin={{ top: 10, right: 12, left: -20, bottom: 0 }}
        accessibilityLayer={false}
      >
        <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="week"
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
        />
        <Tooltip contentStyle={chartTheme.tooltipStyle} />
        <Legend wrapperStyle={chartTheme.legendStyle} />
        <Bar dataKey="raised" name="Raised" fill={colors.amber} radius={[3, 3, 0, 0]} />
        <Line
          type="monotone"
          dataKey="open"
          name="Open at week end"
          stroke={colors.cyan}
          strokeWidth={2}
          dot={{ r: 3, fill: colors.cyan }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
