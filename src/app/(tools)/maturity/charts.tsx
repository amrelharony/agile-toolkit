"use client";

// Recharts lives here so the Maturity page loads it only when a chart
// mounts. Import this module through next/dynamic.
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";
import { MATURITY_LEVEL_LABELS } from "@/lib/constants/maturity-model";
import type { RadarPoint, TrendPoint } from "./chart-text";

/* -------------------------------------------------------------------------- */
/*  Radar tooltip                                                              */
/* -------------------------------------------------------------------------- */

function RadarTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; payload: RadarPoint }>;
}) {
  if (!active || !payload?.length) return null;
  const { subject } = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-lg">
      <p className="font-medium text-text">{subject}</p>
      {payload.map((p) => {
        // Stored levels can drift outside 1-5; clamp at the lookup.
        const clamped = Math.min(5, Math.max(1, Math.round(p.value)));
        return (
          <p key={p.name} className="text-sub">
            {p.name}: level {p.value} — {MATURITY_LEVEL_LABELS[clamped] ?? "Unknown"}
          </p>
        );
      })}
    </div>
  );
}

interface MaturityRadarChartProps {
  data: RadarPoint[];
  /** Injected by ChartCard's ResponsiveContainer. */
  width?: number;
  height?: number;
}

/** The latest assessment, with the one before it dashed when there is one. */
export function MaturityRadarChart({ data, width, height }: MaturityRadarChartProps) {
  const withPrevious = data.some((d) => d.previous !== undefined);
  return (
    <RadarChart
      width={width}
      height={height}
      data={data}
      outerRadius="65%"
      margin={{ top: 10, right: 24, bottom: 10, left: 24 }}
    >
      <PolarGrid gridType="polygon" stroke={chartTheme.gridColor} />
      <PolarAngleAxis
        dataKey="subject"
        tick={{ fill: chartTheme.axisColor, fontSize: 12, fontFamily: "Inter, sans-serif" }}
      />
      <PolarRadiusAxis domain={[0, 5]} tickCount={6} tick={false} axisLine={false} />
      {withPrevious && (
        <Radar
          name="Previous"
          dataKey="previous"
          stroke={chartTheme.colors.purple}
          fill="none"
          strokeDasharray="4 3"
          strokeWidth={1.5}
        />
      )}
      <Radar
        name="Latest"
        dataKey="latest"
        stroke={chartTheme.colors.cyan}
        fill={chartTheme.colors.cyan}
        fillOpacity={0.15}
        strokeWidth={2}
        dot={{ r: 3, fill: chartTheme.colors.cyan, strokeWidth: 0 }}
      />
      <Tooltip content={<RadarTooltip />} />
      {withPrevious && <Legend wrapperStyle={chartTheme.legendStyle} />}
    </RadarChart>
  );
}

/** Overall maturity (0-100%) per saved assessment, oldest first. */
export function MaturityTrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} />
        <XAxis
          dataKey="label"
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={{ stroke: chartTheme.gridColor }}
        />
        <YAxis
          domain={[0, 100]}
          unit="%"
          width={44}
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={{ stroke: chartTheme.gridColor }}
        />
        <Tooltip
          contentStyle={chartTheme.tooltipStyle}
          formatter={(v) => [`${String(v)}%`, "Overall"]}
        />
        <Line
          type="monotone"
          dataKey="percentage"
          name="Overall"
          stroke={chartTheme.colors.cyan}
          strokeWidth={2}
          dot={{ r: 4, fill: chartTheme.colors.cyan, strokeWidth: 0 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
