"use client";

// Recharts lives here so the Onboarding Tracker page loads it only when the
// ramp curve mounts. Import this module through next/dynamic.
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";

export function RampCurveChart({ data }: { data: { day: number; avgPct: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} />
        <XAxis
          dataKey="day"
          tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
          tickFormatter={(v) => `${v}d`}
          axisLine={{ stroke: chartTheme.gridColor }}
        />
        <YAxis
          tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          domain={[0, 100]}
          tickFormatter={(v) => `${v}%`}
        />
        <Tooltip
          contentStyle={chartTheme.tooltipStyle}
          labelFormatter={(v) => `Day ${v}`}
          formatter={(v) => [typeof v === "number" ? `${v.toFixed(1)}%` : String(v), "% complete"]}
        />
        <Line
          type="monotone"
          dataKey="avgPct"
          stroke={chartTheme.colors.cyan}
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
