"use client";

// Recharts lives here so the Vuln Burndown route loads it only when the chart
// mounts. vuln-burndown-client.tsx imports this via next/dynamic.
import { AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, Legend } from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";
import { CausalLine, type CausalAnnotationData } from "@/components/charts/causal-annotation";

type SeverityKey = "critical" | "high" | "medium" | "low";

interface OpenVulnsChartProps {
  /** One row per date with open counts per severity. */
  data: ({ date: string } & Record<SeverityKey, number>)[];
  /** Fill/stroke color per severity. */
  colors: Record<SeverityKey, string>;
  /** CUSUM regime-shift markers. */
  annotations: CausalAnnotationData[];
  width?: number;
  height?: number;
}

export function OpenVulnsChart({ data, colors, annotations, width, height }: OpenVulnsChartProps) {
  return (
    <AreaChart
      width={width}
      height={height}
      data={data}
      margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
    >
      <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} vertical={false} />
      <XAxis
        dataKey="date"
        tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
        axisLine={{ stroke: chartTheme.gridColor }}
        tickLine={false}
      />
      <YAxis
        tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
        axisLine={false}
        tickLine={false}
        allowDecimals={false}
      />
      <Tooltip contentStyle={chartTheme.tooltipStyle} />
      <Legend wrapperStyle={chartTheme.legendStyle} />
      <Area
        type="monotone"
        dataKey="critical"
        stackId="1"
        stroke={colors.critical}
        fill={colors.critical}
        fillOpacity={0.45}
        name="Critical"
      />
      <Area
        type="monotone"
        dataKey="high"
        stackId="1"
        stroke={colors.high}
        fill={colors.high}
        fillOpacity={0.45}
        name="High"
      />
      <Area
        type="monotone"
        dataKey="medium"
        stackId="1"
        stroke={colors.medium}
        fill={colors.medium}
        fillOpacity={0.45}
        name="Medium"
      />
      <Area
        type="monotone"
        dataKey="low"
        stackId="1"
        stroke={colors.low}
        fill={colors.low}
        fillOpacity={0.45}
        name="Low"
      />
      {annotations.map((cp, i) => (
        <CausalLine key={`cusum-${i}`} annotation={cp} />
      ))}
    </AreaChart>
  );
}
