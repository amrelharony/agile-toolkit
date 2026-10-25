"use client";

// Recharts lives here so the Sprint Compare route loads it only when the
// chart mounts. sprint-compare-client.tsx imports this via next/dynamic.
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Polygon,
  Legend,
  Tooltip,
} from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";

/** A point of a sprint's shape as Recharts hands it over: where, and the score (null = not scored). */
interface RadarVertex {
  x: number;
  y: number;
  value?: unknown;
}

/** The vertices of the dimensions the sprint has a score for. */
export function scoredVertices<T extends RadarVertex>(points: readonly T[] | undefined): T[] {
  return (points ?? []).filter((p) => typeof p.value === "number" && Number.isFinite(p.value));
}

/**
 * A sprint's shape through its scored dimensions only. Recharts puts a
 * missing value at the centre, which would draw "not scored" as the worst
 * score; this skips it, so the outline joins the scores either side.
 */
export function ScoredRadarShape({
  points,
  stroke,
  fill,
  fillOpacity,
  strokeWidth,
}: {
  points?: RadarVertex[];
  stroke?: string;
  fill?: string;
  fillOpacity?: number;
  strokeWidth?: number;
}) {
  return (
    <Polygon
      className="recharts-radar-polygon"
      points={scoredVertices(points)}
      stroke={stroke}
      fill={fill}
      fillOpacity={fillOpacity}
      strokeWidth={strokeWidth}
    />
  );
}

interface SprintRadarChartProps {
  /** One row per dimension; each sprint's score keyed by its id (null = not scored). */
  data: Record<string, string | number | null>[];
  /** Sprints to overlay, in order, each with its theme colour. */
  series: { id: string; name: string; color: string }[];
  width?: number;
  height?: number;
}

export function SprintRadarChart({ data, series, width, height }: SprintRadarChartProps) {
  return (
    <RadarChart
      width={width}
      height={height}
      data={data}
      margin={{ top: 10, right: 30, left: 30, bottom: 10 }}
      // ChartCard hides the plot from assistive tech behind its summary and
      // table, so the SVG mustn't be a tab stop.
      accessibilityLayer={false}
    >
      <PolarGrid stroke={chartTheme.gridColor} />
      <PolarAngleAxis dataKey="dimension" tick={{ fill: chartTheme.axisColor, fontSize: 12 }} />
      <PolarRadiusAxis
        domain={[0, 10]}
        tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
        tickCount={6}
        stroke={chartTheme.gridColor}
      />
      <Tooltip
        contentStyle={chartTheme.tooltipStyle}
        formatter={(value) => (value == null ? "Not scored" : value)}
      />
      {series.map((sp) => (
        <Radar
          key={sp.id}
          name={sp.name}
          dataKey={sp.id}
          stroke={sp.color}
          fill={sp.color}
          fillOpacity={0.15}
          strokeWidth={2}
          shape={ScoredRadarShape}
        />
      ))}
      <Legend wrapperStyle={{ paddingTop: "12px", ...chartTheme.legendStyle }} />
    </RadarChart>
  );
}
