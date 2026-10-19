"use client";

// Recharts lives here so the Stacey Matrix route loads it only when the
// chart mounts. stacey-matrix-client.tsx imports this via next/dynamic.
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

export interface StaceyPoint {
  title: string;
  x: number;
  y: number;
  region?: string;
}

export function StaceyScatterChart({ data }: { data: StaceyPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis
          type="number"
          dataKey="x"
          name="Certainty"
          domain={[0, 1]}
          stroke="#888"
          fontSize={11}
          label={{
            value: "Certainty (how)",
            position: "insideBottom",
            offset: -5,
            fill: "#888",
            fontSize: 11,
          }}
        />
        <YAxis
          type="number"
          dataKey="y"
          name="Agreement"
          domain={[0, 1]}
          stroke="#888"
          fontSize={11}
          label={{
            value: "Agreement (what)",
            angle: -90,
            position: "insideLeft",
            fill: "#888",
            fontSize: 11,
          }}
        />
        <ReferenceLine x={0.33} stroke="rgba(255,255,255,0.1)" />
        <ReferenceLine x={0.66} stroke="rgba(255,255,255,0.1)" />
        <ReferenceLine y={0.33} stroke="rgba(255,255,255,0.1)" />
        <ReferenceLine y={0.66} stroke="rgba(255,255,255,0.1)" />
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
