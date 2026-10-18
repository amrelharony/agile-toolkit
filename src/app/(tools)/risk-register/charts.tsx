"use client";

// Recharts lives here so the Risk Register route loads it only when the
// chart mounts. risk-register-client.tsx imports this via next/dynamic.
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { CausalLine, type CausalAnnotationData } from "@/components/charts/causal-annotation";
import { chartTheme } from "@/components/charts/chart-theme";

export interface OpenRiskForecastPoint {
  x: string;
  actual?: number;
  yHat?: number;
  band80Lower?: number;
  band80Upper?: number;
}

interface OpenRiskForecastChartProps {
  data: OpenRiskForecastPoint[];
  /** CUSUM regime shifts, drawn as vertical markers. */
  annotations: CausalAnnotationData[];
}

export function OpenRiskForecastChart({ data, annotations }: OpenRiskForecastChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 12, right: 24, bottom: 24, left: 12 }}>
        <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" />
        <XAxis dataKey="x" stroke={chartTheme.axisColor} fontSize={11} />
        <YAxis stroke={chartTheme.axisColor} fontSize={11} allowDecimals={false} />
        <Tooltip contentStyle={chartTheme.tooltipStyle} />
        <Legend wrapperStyle={chartTheme.legendStyle} />
        <Area
          dataKey="band80Upper"
          stroke="none"
          fill={chartTheme.colors.cyan}
          fillOpacity={0.18}
          name="80% band"
          connectNulls
        />
        <Area
          dataKey="band80Lower"
          stroke="none"
          fill={chartTheme.background}
          fillOpacity={1}
          legendType="none"
          connectNulls
        />
        <Line
          dataKey="actual"
          stroke={chartTheme.colors.cyan}
          strokeWidth={2}
          dot={{ fill: chartTheme.colors.cyan, r: 3 }}
          name="Open risks"
          connectNulls={false}
        />
        <Line
          dataKey="yHat"
          stroke={chartTheme.colors.cyan}
          strokeWidth={2}
          strokeDasharray="5 5"
          dot={false}
          name="Forecast"
          connectNulls
        />
        {annotations.map((ann, i) => (
          <CausalLine key={`cp-${i}`} annotation={ann} />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
