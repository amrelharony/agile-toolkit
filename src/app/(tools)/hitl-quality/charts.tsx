"use client";

// Recharts lives here so the HITL page loads it only when the trend chart
// mounts. Import this module through next/dynamic, never statically.
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

export interface HitlTrendPoint {
  date: string;
  mean: number;
  n: number;
  sum: number;
}

export function HitlMeanRatingChart({ data }: { data: HitlTrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} />
        <XAxis dataKey="date" stroke={chartTheme.axisColor} fontSize={11} />
        <YAxis domain={[1, 5]} stroke={chartTheme.axisColor} fontSize={11} />
        <Tooltip contentStyle={chartTheme.tooltipStyle} />
        <Line dataKey="mean" stroke={chartTheme.colors.cyan} strokeWidth={2} dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
