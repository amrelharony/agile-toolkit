"use client";

// Recharts lives here so the Velocity route loads it only when a chart
// mounts. velocity-client.tsx imports this via next/dynamic.
import {
  ComposedChart,
  Bar,
  Cell,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { CausalLine, type CausalAnnotationData } from "@/components/charts/causal-annotation";
import { chartTheme } from "@/components/charts/chart-theme";
import type { SayDoGrade } from "@/lib/sprints/metrics";

const { colors } = chartTheme;

/*
 * A finished sprint's completed bar wears its say/do grade: met is green,
 * close amber, missed red and over (the team said less than it could do)
 * blue, so "over" doesn't read as a success. The table and the tooltip
 * name the grade too, so colour is never the only cue.
 */
export const GRADE_FILL: Record<SayDoGrade, string> = {
  met: colors.green,
  close: colors.amber,
  missed: colors.red,
  over: colors.blue,
};

export interface VelocityChartRow {
  name: string;
  committed: number;
  completed: number | null;
  /** The finished sprint's say/do grade and percentage. */
  grade?: SayDoGrade;
  sayDoPct?: number;
  rollingAvg?: number;
  trend?: number;
  forecast?: number;
  band80Lower?: number;
  band80Upper?: number;
  /** The synthetic "Next" row that carries only the forecast. */
  forecastOnly?: boolean;
}

interface VelocityChartProps {
  data: VelocityChartRow[];
  width?: number;
  height?: number;
}

const axis = {
  tick: { fill: chartTheme.axisColor, fontSize: 12 },
  tickLine: false,
} as const;

/** Committed and completed by sprint, with the rolling velocity (and the trend once there's enough). */
export function VelocityChart({ data, width, height }: VelocityChartProps) {
  return (
    <ComposedChart
      width={width}
      height={height}
      data={data}
      margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
      // ChartCard hides the plot from assistive tech behind its summary and
      // table, so the SVG mustn't be a tab stop.
      accessibilityLayer={false}
    >
      <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} vertical={false} />
      <XAxis dataKey="name" {...axis} axisLine={{ stroke: chartTheme.gridColor }} />
      <YAxis {...axis} axisLine={false} />
      <Tooltip contentStyle={chartTheme.tooltipStyle} cursor={{ fill: chartTheme.gridColor }} />
      <Legend wrapperStyle={{ paddingTop: "16px", ...chartTheme.legendStyle }} />
      <Bar
        dataKey="committed"
        name="Committed"
        fill={colors.cyan}
        fillOpacity={0.3}
        radius={[4, 4, 0, 0]}
        maxBarSize={60}
      />
      <Bar
        dataKey="completed"
        name="Completed"
        fill={colors.cyan}
        radius={[4, 4, 0, 0]}
        maxBarSize={60}
      >
        {data.map((row, i) => (
          <Cell key={i} fill={row.grade ? GRADE_FILL[row.grade] : colors.cyan} />
        ))}
      </Bar>
      <Line
        dataKey="rollingAvg"
        name="Velocity (last 3)"
        stroke={colors.magenta}
        strokeWidth={2}
        dot={false}
        connectNulls
      />
      <Line
        dataKey="trend"
        name="Trend"
        stroke={colors.amber}
        strokeWidth={1.5}
        strokeDasharray="4 4"
        dot={false}
      />
    </ComposedChart>
  );
}

interface ForecastChartProps {
  data: VelocityChartRow[];
  /** CUSUM regime-shift markers, keyed for React. */
  markers: { key: string; annotation: CausalAnnotationData }[];
}

/**
 * Completed points with the Bayesian forecast band and change points, for
 * Advanced analysis. Sizes itself: it sits in a ChartFigure, not a ChartCard.
 */
export function ForecastChart({ data, markers }: ForecastChartProps) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ForecastPlot data={data} markers={markers} />
    </ResponsiveContainer>
  );
}

function ForecastPlot({
  data,
  markers,
  width,
  height,
}: ForecastChartProps & { width?: number; height?: number }) {
  return (
    <ComposedChart
      width={width}
      height={height}
      data={data}
      margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
      // ChartFigure hides the plot behind its summary and table.
      accessibilityLayer={false}
    >
      <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} vertical={false} />
      <XAxis dataKey="name" {...axis} axisLine={{ stroke: chartTheme.gridColor }} />
      <YAxis {...axis} axisLine={false} />
      <Tooltip contentStyle={chartTheme.tooltipStyle} />
      <Legend wrapperStyle={{ paddingTop: "16px", ...chartTheme.legendStyle }} />
      {/* The 80% band, drawn behind the lines. The lower-mask Area paints
          the background over the upper one, so only the band shows. */}
      <Area
        dataKey="band80Upper"
        name="80% forecast"
        stroke="none"
        fill={colors.cyan}
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
      <Line
        dataKey="completed"
        name="Completed"
        stroke={colors.cyan}
        strokeWidth={2}
        connectNulls
      />
      <Line
        dataKey="forecast"
        name="Forecast"
        stroke={colors.cyan}
        strokeWidth={2}
        strokeDasharray="5 5"
        dot={false}
        connectNulls
      />
      {/* CUSUM regime-shift markers anchored to the sprint's name. */}
      {markers.map((m) => (
        <CausalLine key={m.key} annotation={m.annotation} />
      ))}
    </ComposedChart>
  );
}
