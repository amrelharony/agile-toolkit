"use client";

// Recharts lives here so the Platform Maturity page loads it only when the
// radar mounts. Import this module through next/dynamic.
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Tooltip } from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";

interface PlatformMaturityRadarProps {
  data: { subject: string; value: number; fullMark: number }[];
  /** Injected by ChartCard's ResponsiveContainer. */
  width?: number;
  height?: number;
}

export function PlatformMaturityRadar({ data, width, height }: PlatformMaturityRadarProps) {
  return (
    <RadarChart
      width={width}
      height={height}
      data={data}
      margin={{ top: 16, right: 24, bottom: 16, left: 24 }}
    >
      <PolarGrid stroke={chartTheme.gridColor} />
      <PolarAngleAxis dataKey="subject" tick={{ fill: chartTheme.axisColor, fontSize: 10 }} />
      <PolarRadiusAxis
        angle={90}
        domain={[0, 5]}
        tick={{ fill: chartTheme.axisColor, fontSize: 10 }}
      />
      <Radar
        name="Maturity"
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
