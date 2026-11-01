"use client";

// Recharts lives here so the Test Pyramid page loads it only when the chart
// mounts. Import this module through next/dynamic.
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";

/** Each layer's share (whole percent) per snapshot; a snapshot without one is a gap. */
export function ShapeOverTimeChart({
  data,
}: {
  data: { day: string; unit: number | null; integration: number | null; e2e: number | null }[];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 16, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} vertical={false} />
        <XAxis
          dataKey="day"
          tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          domain={[0, 100]}
          unit="%"
          tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip contentStyle={chartTheme.tooltipStyle} formatter={(v) => `${v}%`} />
        <Legend wrapperStyle={chartTheme.legendStyle} />
        <Line
          dataKey="unit"
          name="Unit"
          stroke={chartTheme.colors.green}
          strokeWidth={2}
          dot={{ r: 3, fill: chartTheme.colors.green }}
        />
        <Line
          dataKey="integration"
          name="Integration"
          stroke={chartTheme.colors.cyan}
          strokeWidth={2}
          dot={{ r: 3, fill: chartTheme.colors.cyan }}
        />
        <Line
          dataKey="e2e"
          name="E2E"
          stroke={chartTheme.colors.amber}
          strokeWidth={2}
          dot={{ r: 3, fill: chartTheme.colors.amber }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
