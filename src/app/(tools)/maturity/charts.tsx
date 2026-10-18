"use client";

// Recharts lives here so the Maturity page loads it only when the radar
// mounts. Import this module through next/dynamic.
import { RadarChart, PolarGrid, PolarAngleAxis, Radar, Tooltip } from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";
import { MATURITY_LEVEL_LABELS } from "@/lib/constants/maturity-model";

/* -------------------------------------------------------------------------- */
/*  Radar tooltip                                                              */
/* -------------------------------------------------------------------------- */

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: { subject: string; value: number } }>;
}) {
  if (!active || !payload?.length) return null;
  const { subject, value } = payload[0].payload;
  // Persisted state can drift outside [1, 5] (corrupted import, future schema
  // change). Clamp at the lookup site so the tooltip never displays "undefined".
  const clamped = Math.min(5, Math.max(1, value));
  const label = MATURITY_LEVEL_LABELS[clamped] ?? "Unknown";
  return (
    <div className="bg-surface border border-border rounded-lg px-3 py-2 text-sm shadow-lg">
      <p className="text-text font-medium">{subject}</p>
      <p className="text-accent">
        Level {value} — {label}
      </p>
    </div>
  );
}

interface MaturityRadarChartProps {
  data: { subject: string; value: number; fullMark: number }[];
  /** Injected by ChartCard's ResponsiveContainer. */
  width?: number;
  height?: number;
}

export function MaturityRadarChart({ data, width, height }: MaturityRadarChartProps) {
  return (
    <RadarChart
      width={width}
      height={height}
      data={data}
      margin={{ top: 20, right: 30, bottom: 20, left: 30 }}
    >
      <PolarGrid gridType="polygon" stroke={chartTheme.gridColor} />
      <PolarAngleAxis
        dataKey="subject"
        tick={{
          fill: chartTheme.axisColor,
          fontSize: 11,
          fontFamily: "Inter, sans-serif",
        }}
      />
      <Radar
        name="Maturity"
        dataKey="value"
        stroke={chartTheme.colors.cyan}
        fill={chartTheme.colors.cyan}
        fillOpacity={0.15}
        strokeWidth={2}
        dot={{ r: 4, fill: chartTheme.colors.cyan, strokeWidth: 0 }}
      />
      <Tooltip content={<CustomTooltip />} />
    </RadarChart>
  );
}
