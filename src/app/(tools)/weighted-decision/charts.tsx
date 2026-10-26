"use client";

// Recharts lives here so the Weighted Decision route loads it only when the
// chart mounts. weighted-decision-client.tsx imports this via next/dynamic.
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";

export interface TotalBar {
  /** "1. LaunchDarkly": the rank keeps two similar names apart on the axis. */
  name: string;
  total: number;
  leader: boolean;
}

/**
 * The complete options' weighted totals, best first. The leader's bar is
 * green and the rest share the accent; ChartFigure's summary and table
 * say the same in words.
 */
export function WeightedScoreChart({ data }: { data: TotalBar[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      {/* ChartFigure hides the plot behind its summary and table, so the SVG
          mustn't be a tab stop. */}
      <BarChart
        data={data}
        layout="vertical"
        margin={{ left: 8, right: 16 }}
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
          dataKey="name"
          width={140}
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip contentStyle={chartTheme.tooltipStyle} />
        <Bar dataKey="total" name="Total" maxBarSize={28}>
          {data.map((d) => (
            <Cell key={d.name} fill={d.leader ? chartTheme.colors.green : chartTheme.colors.cyan} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
