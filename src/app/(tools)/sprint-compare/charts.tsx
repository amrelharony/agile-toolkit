"use client";

// Recharts lives here so the Sprint Compare route loads it only when the
// chart mounts. sprint-compare-client.tsx imports this via next/dynamic.
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Legend,
  Tooltip,
} from "recharts";

const TOOLTIP_STYLE = {
  backgroundColor: "#1a1f36",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "8px",
  color: "#e2e8f0",
};

interface SprintRadarChartProps {
  /** One row per dimension; each sprint's score is keyed by its id. */
  data: Record<string, string | number>[];
  /** Sprints to overlay, in order. */
  series: { id: string; name: string }[];
  /** Series colors, cycled by index. */
  colors: readonly string[];
  width?: number;
  height?: number;
}

export function SprintRadarChart({ data, series, colors, width, height }: SprintRadarChartProps) {
  return (
    <RadarChart
      width={width}
      height={height}
      data={data}
      margin={{ top: 10, right: 30, left: 30, bottom: 10 }}
    >
      <PolarGrid stroke="rgba(255,255,255,0.1)" />
      <PolarAngleAxis dataKey="dimension" tick={{ fill: "#94a3b8", fontSize: 12 }} />
      <PolarRadiusAxis
        domain={[0, 10]}
        tick={{ fill: "#94a3b8", fontSize: 10 }}
        tickCount={6}
        stroke="rgba(255,255,255,0.05)"
      />
      <Tooltip contentStyle={TOOLTIP_STYLE} />
      {series.map((sp, i) => (
        <Radar
          key={sp.id}
          name={sp.name}
          dataKey={sp.id}
          stroke={colors[i % colors.length]}
          fill={colors[i % colors.length]}
          fillOpacity={0.15}
          strokeWidth={2}
        />
      ))}
      <Legend wrapperStyle={{ paddingTop: "12px", color: "#94a3b8", fontSize: 12 }} />
    </RadarChart>
  );
}
