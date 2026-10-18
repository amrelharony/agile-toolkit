"use client";

// Recharts lives here so the Impediments page loads it only when the weekly
// trend chart mounts. Import this module through next/dynamic.
import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip } from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";
import { CausalLine, type CausalAnnotationData } from "@/components/charts/causal-annotation";

interface WeeklyRaisedChartProps {
  data: { week: string; raised: number }[];
  changepoints: CausalAnnotationData[];
  /** Injected by ChartCard's ResponsiveContainer. */
  width?: number;
  height?: number;
}

export function WeeklyRaisedChart({ data, changepoints, width, height }: WeeklyRaisedChartProps) {
  return (
    <LineChart
      width={width}
      height={height}
      data={data}
      margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
    >
      <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" vertical={false} />
      <XAxis
        dataKey="week"
        tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
        axisLine={{ stroke: chartTheme.gridColor }}
        tickLine={false}
      />
      <YAxis
        tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
        axisLine={false}
        tickLine={false}
        allowDecimals={false}
      />
      <Tooltip contentStyle={chartTheme.tooltipStyle} />
      <Line
        type="monotone"
        dataKey="raised"
        stroke={chartTheme.colors.cyan}
        strokeWidth={2}
        dot={{ r: 3 }}
        name="Raised / week"
      />
      {changepoints.map((cp, i) => (
        <CausalLine key={`raised-cusum-${i}`} annotation={cp} />
      ))}
    </LineChart>
  );
}
