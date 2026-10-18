"use client";

// Recharts lives here so the Value/Effort Matrix route loads it only when the
// chart mounts. value-effort-matrix-client.tsx imports this via next/dynamic.
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";

export interface ValueEffortPoint {
  title: string;
  x: number;
  y: number;
  quadrant: string;
}

export function ValueEffortScatterChart({ data }: { data: ValueEffortPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis
          type="number"
          dataKey="x"
          name="Effort"
          domain={[0, 10]}
          stroke="#888"
          fontSize={11}
          label={{
            value: "Effort",
            position: "insideBottom",
            offset: -5,
            fill: "#888",
            fontSize: 11,
          }}
        />
        <YAxis
          type="number"
          dataKey="y"
          name="Value"
          domain={[0, 10]}
          stroke="#888"
          fontSize={11}
          label={{
            value: "Value",
            angle: -90,
            position: "insideLeft",
            fill: "#888",
            fontSize: 11,
          }}
        />
        <ReferenceLine x={5} stroke="rgba(255,255,255,0.15)" />
        <ReferenceLine y={5} stroke="rgba(255,255,255,0.15)" />
        <Tooltip
          cursor={{ strokeDasharray: "3 3" }}
          contentStyle={{
            backgroundColor: "#0f1117",
            border: "1px solid #2a2f3a",
            fontSize: 12,
          }}
        />
        <Scatter data={data} fill="#00f0ff" />
      </ScatterChart>
    </ResponsiveContainer>
  );
}
