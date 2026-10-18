"use client";

// Recharts lives here so the Cost of Delay page loads it only when the
// chart mounts. Import this module through next/dynamic, never statically.
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";

export function CostOfDelayChart({ data }: { data: Array<{ title: string; cost: number }> }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ left: 16 }}>
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
        <Bar dataKey="cost" fill="#ff6b6b" />
      </BarChart>
    </ResponsiveContainer>
  );
}
