"use client";

// Recharts lives here so the SLO Builder route loads it only when the chart
// mounts. slo-builder-client.tsx imports this via next/dynamic.
import { AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, Legend } from "recharts";
import { chartTheme, CHART_COLORS } from "@/components/charts/chart-theme";
import { CausalLine, type CausalAnnotationData } from "@/components/charts/causal-annotation";

interface CumulativeErrorChartProps {
  /** One row per date; each SLO's running total is keyed by its id. */
  data: Record<string, string | number>[];
  /** SLOs to stack, in order. */
  series: { id: string; name: string }[];
  /** CUSUM regime-shift markers; undefined draws none. */
  annotations?: CausalAnnotationData[];
  width?: number;
  height?: number;
}

export function CumulativeErrorChart({
  data,
  series,
  annotations,
  width,
  height,
}: CumulativeErrorChartProps) {
  return (
    <AreaChart
      width={width}
      height={height}
      data={data}
      margin={{ top: 8, right: 12, left: -16, bottom: 4 }}
    >
      <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" />
      <XAxis dataKey="date" tick={{ fill: chartTheme.axisColor, fontSize: 11 }} />
      <YAxis tick={{ fill: chartTheme.axisColor, fontSize: 11 }} />
      <Tooltip contentStyle={chartTheme.tooltipStyle} />
      <Legend wrapperStyle={chartTheme.legendStyle} />
      {series.map((slo, i) => (
        <Area
          key={slo.id}
          type="monotone"
          // dataKey is the SLO's id; name carries the human label
          // for legend/tooltip without colliding on duplicates.
          dataKey={slo.id}
          name={slo.name}
          stackId="1"
          stroke={CHART_COLORS[i % CHART_COLORS.length]}
          fill={CHART_COLORS[i % CHART_COLORS.length]}
          fillOpacity={0.35}
        />
      ))}
      {/* CUSUM regime-shift markers on the (longest) burn series. */}
      {annotations?.map((cp, i) => (
        <CausalLine key={`cusum-${i}`} annotation={cp} />
      ))}
    </AreaChart>
  );
}
