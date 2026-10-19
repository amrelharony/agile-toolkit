"use client";

// Recharts lives here so the feature-flag tracker loads it only when a
// chart mounts. Import this module through next/dynamic, never statically.
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";

/** Kaplan-Meier survival curve of flag age before retirement. */
export function FlagSurvivalChart({ data }: { data: Array<{ t: number; survival: number }> }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" />
        <XAxis
          dataKey="t"
          tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          label={{
            value: "days",
            fill: chartTheme.axisColor,
            fontSize: 10,
            position: "insideBottom",
            offset: -2,
          }}
        />
        <YAxis
          domain={[0, 1]}
          tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          tickFormatter={(v) => `${Math.round(v * 100)}%`}
        />
        <Tooltip
          contentStyle={chartTheme.tooltipStyle}
          formatter={(v) => [`${(Number(v) * 100).toFixed(1)}%`, "still active"]}
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

/** Active flags bucketed by age. */
export function FlagAgeChart({ data }: { data: Array<{ bucket: string; count: number }> }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} />
        <XAxis
          dataKey="bucket"
          tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
          axisLine={{ stroke: chartTheme.gridColor }}
        />
        <YAxis
          tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          allowDecimals={false}
        />
        <Tooltip contentStyle={chartTheme.tooltipStyle} formatter={(v) => [String(v), "Flags"]} />
        <Bar dataKey="count" fill={chartTheme.colors.cyan} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
