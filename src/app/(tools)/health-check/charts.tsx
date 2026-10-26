"use client";

// Recharts lives here so the health check loads it only when the trend
// chart mounts. Import this module through next/dynamic, never statically.
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";
import type { HealthTrendRow } from "./chart-text";

/**
 * Health per saved check, 0–100% (yellow counts half): one line, so the
 * direction reads at a glance. Each dimension's light is in the figure's
 * table, where eight overlapping lines on three levels never were.
 */
export function HealthTrendChart({ data }: { data: HealthTrendRow[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      {/* ChartFigure hides the plot from assistive tech behind its summary and
          table, so the SVG mustn't be a tab stop. */}
      <LineChart
        data={data}
        margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
        accessibilityLayer={false}
      >
        <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="name"
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          tickLine={false}
        />
        <YAxis
          domain={[0, 100]}
          ticks={[0, 25, 50, 75, 100]}
          tickFormatter={(v) => `${v}%`}
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          width={48}
        />
        <ReferenceLine y={75} stroke={chartTheme.gridColor} strokeDasharray="4 4" />
        <Tooltip contentStyle={chartTheme.tooltipStyle} formatter={(v) => [`${v}%`, "Health"]} />
        <Line
          type="monotone"
          dataKey="health"
          name="Health"
          stroke={chartTheme.colors.cyan}
          strokeWidth={2}
          dot={{ r: 3 }}
          activeDot={{ r: 5 }}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
