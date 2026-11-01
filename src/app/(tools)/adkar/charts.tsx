"use client";

// Recharts lives here so the ADKAR page loads it only when the chart
// mounts. Import this module through next/dynamic, never statically.
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from "recharts";
import { CHART_COLORS, chartTheme } from "@/components/charts/chart-theme";

export interface AdkarFunnelRow {
  stage: string;
  count: number;
}

/** Initiatives per current stage, one theme colour per stage (never a stored hex). */
export function AdkarStageFunnelChart({ data }: { data: AdkarFunnelRow[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} />
        <XAxis
          type="number"
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          allowDecimals={false}
        />
        <YAxis
          type="category"
          dataKey="stage"
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          width={104}
        />
        <Tooltip
          contentStyle={chartTheme.tooltipStyle}
          formatter={(v) => [String(v), "Initiatives"]}
        />
        <Bar dataKey="count" radius={[0, 4, 4, 0]}>
          {data.map((d, idx) => (
            <Cell key={d.stage} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
