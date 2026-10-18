"use client";

// Recharts lives here so the On-call Roster page loads it only when the
// paging chart mounts. Import this module through next/dynamic.
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

interface PagingFrequencyChartProps {
  data: { week: string; pages: number }[];
  changepoints: CausalAnnotationData[];
}

export function PagingFrequencyChart({ data, changepoints }: PagingFrequencyChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" />
        <XAxis
          dataKey="week"
          tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
          axisLine={{ stroke: chartTheme.gridColor }}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
          axisLine={{ stroke: chartTheme.gridColor }}
        />
        <Tooltip contentStyle={chartTheme.tooltipStyle} formatter={(v) => [String(v), "pages"]} />
        {changepoints.map((a, i) => (
          <CausalLine key={`cp-${i}`} annotation={a} />
        ))}
        <Line
          type="monotone"
          dataKey="pages"
          stroke={chartTheme.colors.cyan}
          strokeWidth={2}
          dot={{ r: 2, fill: chartTheme.colors.cyan }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
