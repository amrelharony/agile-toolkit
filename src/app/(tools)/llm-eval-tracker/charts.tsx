"use client";

// Recharts lives here so the LLM Eval Tracker page loads it only when the
// score chart mounts. Import this module through next/dynamic.
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";

const COLORS = ["#00f0ff", "#ff00aa", "#00ff88", "#ffaa00", "#9d4edd", "#ff6b6b"];

interface ScoreOverTimeChartProps {
  data: Record<string, string | number>[];
  series: { key: string; label: string }[];
}

export function ScoreOverTimeChart({ data, series }: ScoreOverTimeChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis dataKey="date" stroke="#888" fontSize={11} />
        <YAxis domain={[0, 1]} stroke="#888" fontSize={11} />
        <Tooltip
          contentStyle={{
            backgroundColor: "#0f1117",
            border: "1px solid #2a2f3a",
            fontSize: 12,
          }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <ReferenceLine y={0.8} stroke="#00ff88" strokeDasharray="4 4" />
        {series.map((d, i) => (
          <Line
            key={d.key}
            dataKey={d.key}
            name={d.label}
            stroke={COLORS[i % COLORS.length]}
            strokeWidth={2}
            dot={{ r: 3 }}
            // R10: do NOT connectNulls. Most rows for a series
            // have `undefined` (only a single eval per date).
            // Bridging across undefined draws a smooth line
            // over weeks of no measurement, falsely implying
            // continuous data.
            connectNulls={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
