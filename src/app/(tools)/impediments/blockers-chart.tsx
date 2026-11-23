"use client";

// Recharts lives here so the Impediments page loads it only when the
// blockers chart mounts. Import this module through next/dynamic.
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";

export interface ClusterBar {
  /** The cluster's name, cut for the axis. */
  name: string;
  value: number;
  /** One of the vital few. */
  vital: boolean;
}

const { colors } = chartTheme;

/**
 * The clusters as bars, most first: the measure (blocked days or
 * impediments raised) per cluster, the vital few in the strong colour and
 * the rest muted. The figure around it says the same in words and a table.
 */
export function BlockersParetoChart({ data, unit }: { data: ClusterBar[]; unit: string }) {
  const height = Math.max(160, data.length * 34 + 40);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart
        layout="vertical"
        data={data}
        margin={{ top: 4, right: 12, left: 4, bottom: 0 }}
        accessibilityLayer={false}
      >
        <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          tickLine={false}
          allowDecimals={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={120}
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip contentStyle={chartTheme.tooltipStyle} formatter={(v) => [`${v} ${unit}`, ""]} />
        <Bar dataKey="value" name={unit} radius={[0, 3, 3, 0]}>
          {data.map((d) => (
            <Cell
              key={d.name}
              fill={d.vital ? colors.amber : colors.cyan}
              fillOpacity={d.vital ? 1 : 0.5}
            />
          ))}
        </Bar>
      </ComposedChart>
    </ResponsiveContainer>
  );
}
