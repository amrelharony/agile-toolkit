"use client";

// Recharts lives here so the SPACE Pulse route loads it only when the chart
// mounts. space-pulse-client.tsx imports this via next/dynamic.
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Tooltip } from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";

interface SpaceRadarChartProps {
  data: { subject: string; value: number; fullMark: number }[];
  width?: number;
  height?: number;
}

export function SpaceRadarChart({ data, width, height }: SpaceRadarChartProps) {
  return (
    <RadarChart
      width={width}
      height={height}
      data={data}
      margin={{ top: 16, right: 24, bottom: 16, left: 24 }}
    >
      <PolarGrid stroke={chartTheme.gridColor} />
      <PolarAngleAxis dataKey="subject" tick={{ fill: chartTheme.axisColor, fontSize: 11 }} />
      <PolarRadiusAxis
        angle={90}
        domain={[0, 5]}
        tick={{ fill: chartTheme.axisColor, fontSize: 10 }}
      />
      <Radar
        name="SPACE"
        dataKey="value"
        stroke={chartTheme.colors.cyan}
        fill={chartTheme.colors.cyan}
        fillOpacity={0.2}
        strokeWidth={2}
      />
      <Tooltip contentStyle={chartTheme.tooltipStyle} />
    </RadarChart>
  );
}
