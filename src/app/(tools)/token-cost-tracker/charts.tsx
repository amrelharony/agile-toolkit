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

interface DailySpendChartProps {
  data: { date: string; cost: number; tokens: number }[];
  /** Daily budget line, in USD. */
  dailyBudgetUsd: number;
}

export function DailySpendChart({ data, dailyBudgetUsd }: DailySpendChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis dataKey="date" stroke="#888" fontSize={11} />
        <YAxis stroke="#888" fontSize={11} />
        <Tooltip
          contentStyle={{
            backgroundColor: "#0f1117",
            border: "1px solid #2a2f3a",
            fontSize: 12,
          }}
        />
        <ReferenceLine
          y={dailyBudgetUsd}
          stroke="#ff6b6b"
          strokeDasharray="4 4"
          label={{
            value: "daily budget",
            position: "right",
            fill: "#ff6b6b",
            fontSize: 10,
          }}
        />
        <Area dataKey="cost" stroke="#00f0ff" fill="#00f0ff20" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
