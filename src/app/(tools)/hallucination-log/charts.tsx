"use client";

// Recharts lives here so the hallucination log loads it only when a chart
// mounts. Import this module through next/dynamic, never statically.
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";

export function SeverityCountsChart({
  data,
}: {
  data: Array<{ severity: string; count: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} />
        <XAxis dataKey="severity" stroke={chartTheme.axisColor} fontSize={11} />
        <YAxis stroke={chartTheme.axisColor} fontSize={11} />
        <Tooltip contentStyle={chartTheme.tooltipStyle} />
        <Bar dataKey="count" fill={chartTheme.colors.red} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function CauseCountsChart({ data }: { data: Array<{ cause: string; count: number }> }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} />
        <XAxis dataKey="cause" stroke={chartTheme.axisColor} fontSize={11} />
        <YAxis stroke={chartTheme.axisColor} fontSize={11} />
        <Tooltip contentStyle={chartTheme.tooltipStyle} />
        <Bar dataKey="count" fill={chartTheme.colors.purple} />
      </BarChart>
    </ResponsiveContainer>
  );
}
