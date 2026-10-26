"use client";

// Recharts lives here so the page loads it only when the adherence chart
// mounts. Import this module through next/dynamic.
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";
import type { AdherencePoint } from "./trend";

/** Each saved check-in's adherence, oldest first. */
export function AdherenceChart({ data }: { data: AdherencePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      {/* ChartFigure hides the plot behind its summary and table, so the SVG
          mustn't be a tab stop. */}
      <LineChart
        data={data}
        margin={{ top: 8, right: 12, left: -12, bottom: 0 }}
        accessibilityLayer={false}
      >
        <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `${v}%`}
        />
        <Tooltip
          contentStyle={chartTheme.tooltipStyle}
          formatter={(v, _name, item) => {
            const p = (item as { payload?: AdherencePoint } | undefined)?.payload;
            return [p ? `${v}% (${p.working} of ${p.checked})` : `${v}%`, "Working"];
          }}
        />
        <Line
          type="monotone"
          dataKey="pct"
          name="Working"
          stroke={chartTheme.colors.cyan}
          strokeWidth={2}
          dot={{ fill: chartTheme.colors.cyan, r: 3 }}
          activeDot={{ r: 5 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
