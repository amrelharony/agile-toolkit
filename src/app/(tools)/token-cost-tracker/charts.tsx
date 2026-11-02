"use client";

// Recharts lives here so the Token Cost Tracker route loads it only when the
// chart mounts. token-cost-tracker-client.tsx imports this via next/dynamic.
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";
import { tint } from "@/lib/utils/theme-color";

interface DailySpendChartProps {
  data: { date: string; cost: number; tokens: number }[];
  /** Daily budget line, in USD. */
  dailyBudgetUsd: number;
}

export function DailySpendChart({ data, dailyBudgetUsd }: DailySpendChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} />
        <XAxis dataKey="date" stroke={chartTheme.axisColor} fontSize={11} />
        <YAxis stroke={chartTheme.axisColor} fontSize={11} />
        <Tooltip contentStyle={chartTheme.tooltipStyle} />
        <ReferenceLine
          y={dailyBudgetUsd}
          stroke={chartTheme.colors.red}
          strokeDasharray="4 4"
          label={{
            value: "daily budget",
            position: "right",
            fill: chartTheme.colors.red,
            fontSize: 10,
          }}
        />
        <Area
          dataKey="cost"
          stroke={chartTheme.colors.cyan}
          fill={tint(chartTheme.colors.cyan, 13)}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
