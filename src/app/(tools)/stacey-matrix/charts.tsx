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
import { chartTheme } from "@/components/charts/chart-theme";

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
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} />
        <XAxis
          type="number"
          dataKey="x"
          name="Certainty"
          domain={[0, 1]}
          stroke={chartTheme.axisColor}
          fontSize={11}
          label={{
            value: "Certainty (how)",
            position: "insideBottom",
            offset: -5,
            fill: chartTheme.axisColor,
            fontSize: 11,
          }}
        />
        <YAxis
          type="number"
          dataKey="y"
          name="Agreement"
          domain={[0, 1]}
          stroke={chartTheme.axisColor}
          fontSize={11}
          label={{
            value: "Agreement (what)",
            angle: -90,
            position: "insideLeft",
            fill: chartTheme.axisColor,
            fontSize: 11,
          }}
        />
        <ReferenceLine x={0.33} stroke={chartTheme.gridColor} />
        <ReferenceLine x={0.66} stroke={chartTheme.gridColor} />
        <ReferenceLine y={0.33} stroke={chartTheme.gridColor} />
        <ReferenceLine y={0.66} stroke={chartTheme.gridColor} />
        <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={chartTheme.tooltipStyle} />
        <Scatter data={data} fill={chartTheme.colors.cyan} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}
