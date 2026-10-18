"use client";

// Recharts lives here so the Velocity route loads it only when the chart
// mounts. velocity-client.tsx imports this via next/dynamic.
import {
  ComposedChart,
  Bar,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { CausalLine, type CausalAnnotationData } from "@/components/charts/causal-annotation";
import { chartTheme } from "@/components/charts/chart-theme";

const TOOLTIP_STYLE = {
  backgroundColor: "#1a1f36",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "8px",
  color: "#e2e8f0",
};

export interface VelocityChartRow {
  name: string;
  committed: number;
  completed: number | null;
  rollingAvg?: number;
  trend?: number;
  forecast?: number;
  band80Lower?: number;
  band80Upper?: number;
}

interface VelocityChartProps {
  data: VelocityChartRow[];
  /** CUSUM regime-shift markers, keyed for React. */
  markers: { key: string; annotation: CausalAnnotationData }[];
  width?: number;
  height?: number;
}

export function VelocityChart({ data, markers, width, height }: VelocityChartProps) {
  return (
    <ComposedChart
      width={width}
      height={height}
      data={data}
      margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
    >
      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
      <XAxis
        dataKey="name"
        tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
        axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
        tickLine={false}
      />
      <YAxis
        tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
        axisLine={false}
        tickLine={false}
      />
      <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
      <Legend wrapperStyle={{ paddingTop: "16px", color: chartTheme.axisColor, fontSize: 12 }} />
      {/* Bayesian 80% band — drawn behind everything so bars stay legible.
          The lower-mask Area uses var(--bg) at fillOpacity 1 to clip the
          upper Area down to a true band rather than a solid wedge. */}
      <Area
        dataKey="band80Upper"
        name="80% forecast"
        stroke="none"
        fill={chartTheme.colors.cyan}
        fillOpacity={0.18}
        connectNulls
        isAnimationActive={false}
      />
      <Area
        dataKey="band80Lower"
        stroke="none"
        fill={chartTheme.background}
        fillOpacity={1}
        legendType="none"
        connectNulls
        isAnimationActive={false}
      />
      <Bar
        dataKey="committed"
        name="Committed"
        fill="rgba(0,240,255,0.3)"
        radius={[4, 4, 0, 0]}
        maxBarSize={60}
      />
      <Bar
        dataKey="completed"
        name="Completed"
        fill={chartTheme.colors.cyan}
        radius={[4, 4, 0, 0]}
        maxBarSize={60}
      />
      <Line
        dataKey="rollingAvg"
        name="Rolling Avg"
        stroke={chartTheme.colors.magenta}
        strokeWidth={2}
        dot={false}
        connectNulls
      />
      <Line
        dataKey="trend"
        name="Trend"
        stroke={chartTheme.colors.amber}
        strokeWidth={1.5}
        strokeDasharray="4 4"
        dot={false}
      />
      <Line
        dataKey="forecast"
        name="Forecast"
        stroke={chartTheme.colors.cyan}
        strokeWidth={2}
        strokeDasharray="5 5"
        dot={false}
        connectNulls
      />
      {/* CUSUM regime-shift markers anchored to the affected sprint's
          name so they line up with bar centers. */}
      {markers.map((m) => (
        <CausalLine key={m.key} annotation={m.annotation} />
      ))}
    </ComposedChart>
  );
}
