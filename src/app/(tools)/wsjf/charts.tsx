"use client";

// Recharts lives here so the WSJF route loads it only when the chart
// mounts. wsjf-client.tsx imports this via next/dynamic.
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";

/** The top features by WSJF, one bar each, highest first (theme colours only). */
export function WsjfScoreChart({ data }: { data: { title: string; score: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      {/* ChartFigure gives the chart its summary and table, so the SVG
          mustn't be a tab stop. */}
      <BarChart
        data={data}
        layout="vertical"
        margin={{ left: 8, right: 12 }}
        accessibilityLayer={false}
      >
        <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="title"
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          width={130}
        />
        <Tooltip contentStyle={chartTheme.tooltipStyle} />
        <Bar dataKey="score" name="WSJF" fill={chartTheme.colors.purple} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}
