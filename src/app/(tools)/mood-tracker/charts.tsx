"use client";

// Recharts lives here so the Mood Tracker page loads it only when the
// daily-average chart mounts. Import this module through next/dynamic.
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";
import { CausalLine, type CausalAnnotationData } from "@/components/charts/causal-annotation";

interface DailyMoodChartProps {
  data: { date: string; avg: number }[];
  changepoints: CausalAnnotationData[];
}

export function DailyMoodChart({ data, changepoints }: DailyMoodChartProps) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          domain={[1, 5]}
          ticks={[1, 2, 3, 4, 5]}
        />
        <Tooltip contentStyle={chartTheme.tooltipStyle} />
        <Line
          type="monotone"
          dataKey="avg"
          stroke={chartTheme.colors.cyan}
          strokeWidth={2}
          dot={{ r: 3 }}
          name="Daily avg"
        />
        {changepoints.map((cp, i) => (
          <CausalLine key={`cusum-${i}`} annotation={cp} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
