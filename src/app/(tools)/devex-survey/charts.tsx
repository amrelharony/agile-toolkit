"use client";

// Recharts lives here so the DevEx survey page loads it only when the chart
// mounts. Import this module through next/dynamic, never statically.
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend } from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";

export interface DevexDistributionRow {
  score: string;
  flow: number;
  feedback: number;
  cognitive: number;
}

export function DevexScoreDistributionChart({
  data,
  width,
  height,
}: {
  data: DevexDistributionRow[];
  /** Injected by ChartCard's ResponsiveContainer. */
  width?: number;
  height?: number;
}) {
  return (
    <BarChart
      width={width}
      height={height}
      data={data}
      margin={{ top: 8, right: 12, left: -16, bottom: 4 }}
    >
      <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" />
      <XAxis dataKey="score" tick={{ fill: chartTheme.axisColor, fontSize: 11 }} />
      <YAxis allowDecimals={false} tick={{ fill: chartTheme.axisColor, fontSize: 11 }} />
      <Tooltip contentStyle={chartTheme.tooltipStyle} />
      <Legend wrapperStyle={chartTheme.legendStyle} />
      <Bar dataKey="flow" name="Flow" fill={chartTheme.colors.cyan} />
      <Bar dataKey="feedback" name="Feedback" fill={chartTheme.colors.green} />
      <Bar dataKey="cognitive" name="Cog. load" fill={chartTheme.colors.amber} />
    </BarChart>
  );
}
