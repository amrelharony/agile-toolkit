"use client";

// Recharts lives here so the HITL page loads it only when the trend chart
// mounts. Import this module through next/dynamic, never statically.
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

export interface HitlTrendPoint {
  date: string;
  mean: number;
  n: number;
  sum: number;
}

export function HitlMeanRatingChart({ data }: { data: HitlTrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis dataKey="date" stroke="#888" fontSize={11} />
        <YAxis domain={[1, 5]} stroke="#888" fontSize={11} />
        <Tooltip
          contentStyle={{
            backgroundColor: "#0f1117",
            border: "1px solid #2a2f3a",
            fontSize: 12,
          }}
        />
        <Line dataKey="mean" stroke="#00f0ff" strokeWidth={2} dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
