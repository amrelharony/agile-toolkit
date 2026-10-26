"use client";

// Recharts lives here so the Cost of Delay route loads it only when the
// chart mounts. cost-of-delay-client.tsx imports this via next/dynamic.
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";

/** The initiatives with the highest CD3, one bar each, highest first (theme colours only). */
export function CostOfDelayChart({ data }: { data: { title: string; cd3: number }[] }) {
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
        <Bar dataKey="cd3" name="CD3" fill={chartTheme.colors.amber} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}
