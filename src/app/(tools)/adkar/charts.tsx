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
import { chartTheme } from "@/components/charts/chart-theme";

export interface AdkarFunnelRow {
  stage: string;
  count: number;
  color: string;
}

export function AdkarStageFunnelChart({ data }: { data: AdkarFunnelRow[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} />
        <XAxis
          type="number"
          tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          allowDecimals={false}
        />
        <YAxis
          type="category"
          dataKey="stage"
          tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          width={100}
        />
        <Tooltip
          contentStyle={chartTheme.tooltipStyle}
          formatter={(v) => [String(v), "Initiatives"]}
        />
        <Bar dataKey="count" radius={[0, 4, 4, 0]}>
          {data.map((d, idx) => (
            <Cell key={idx} fill={d.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
