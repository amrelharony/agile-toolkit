"use client";

// Recharts lives here so the hallucination log loads it only when a chart
// mounts. Import this module through next/dynamic, never statically.
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

export function SeverityCountsChart({
  data,
}: {
  data: Array<{ severity: string; count: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis dataKey="severity" stroke="#888" fontSize={11} />
        <YAxis stroke="#888" fontSize={11} />
        <Tooltip
          contentStyle={{
            backgroundColor: "#0f1117",
            border: "1px solid #2a2f3a",
            fontSize: 12,
          }}
        />
        <Bar dataKey="count" fill="#ff6b6b" />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function CauseCountsChart({ data }: { data: Array<{ cause: string; count: number }> }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis dataKey="cause" stroke="#888" fontSize={11} />
        <YAxis stroke="#888" fontSize={11} />
        <Tooltip
          contentStyle={{
            backgroundColor: "#0f1117",
            border: "1px solid #2a2f3a",
            fontSize: 12,
          }}
        />
        <Bar dataKey="count" fill="#9d4edd" />
      </BarChart>
    </ResponsiveContainer>
  );
}
