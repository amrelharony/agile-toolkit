"use client";

// Recharts lives here so the WSJF route loads it only when the chart
// mounts. wsjf-client.tsx imports this via next/dynamic.
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";

export function WsjfScoreChart({ data }: { data: { title: string; score: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ left: 80 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis type="number" stroke="#888" fontSize={11} />
        <YAxis type="category" dataKey="title" stroke="#888" fontSize={11} width={150} />
        <Tooltip
          contentStyle={{
            backgroundColor: "#0f1117",
            border: "1px solid #2a2f3a",
            fontSize: 12,
          }}
        />
        <Bar dataKey="score" fill="#9d4edd" />
      </BarChart>
    </ResponsiveContainer>
  );
}
