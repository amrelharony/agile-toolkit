"use client";

// Recharts lives here so the Incident Commander page loads it only when the
// MTTR survival chart mounts. Import this module through next/dynamic.
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

export interface MttrSurvivalPoint {
  t: number;
  survival: number;
}

export function MttrSurvivalChart({ data }: { data: MttrSurvivalPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" />
        <XAxis
          dataKey="t"
          tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          label={{
            value: "minutes",
            fill: chartTheme.axisColor,
            fontSize: 10,
            position: "insideBottom",
            offset: -2,
          }}
        />
        <YAxis
          domain={[0, 1]}
          tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          tickFormatter={(v) => `${Math.round(v * 100)}%`}
        />
        <Tooltip
          contentStyle={chartTheme.tooltipStyle}
          formatter={(v) => [`${(Number(v) * 100).toFixed(1)}%`, "still open"]}
          labelFormatter={(v) => `${v}m`}
        />
        <Line
          type="stepAfter"
          dataKey="survival"
          stroke={chartTheme.colors.cyan}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
