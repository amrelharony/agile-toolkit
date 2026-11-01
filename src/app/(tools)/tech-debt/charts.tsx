"use client";

// Recharts lives here so the Tech Debt route loads it only when the chart
// mounts. tech-debt-client.tsx imports this via next/dynamic.
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";

/** Kaplan-Meier step curve: share of debt items still open after `t` days. */
export function ResolutionSurvivalChart({ data }: { data: { t: number; survival: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      {/* ChartFigure hides the plot behind its summary and table, so the SVG
          mustn't be a tab stop. */}
      <LineChart
        data={data}
        margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
        accessibilityLayer={false}
      >
        <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" />
        <XAxis
          dataKey="t"
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          label={{
            value: "days",
            fill: chartTheme.axisColor,
            fontSize: 12,
            position: "insideBottom",
            offset: -2,
          }}
        />
        <YAxis
          domain={[0, 1]}
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          tickFormatter={(v) => `${Math.round(v * 100)}%`}
        />
        <Tooltip
          contentStyle={chartTheme.tooltipStyle}
          formatter={(v) => [`${(Number(v) * 100).toFixed(1)}%`, "still open"]}
          labelFormatter={(v) => `${v}d`}
        />
        <Line
          type="stepAfter"
          dataKey="survival"
          stroke={chartTheme.colors.cyan}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
