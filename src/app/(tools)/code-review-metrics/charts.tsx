"use client";

// Recharts lives here so the code-review page loads it only when a chart
// mounts. Import this module through next/dynamic, never statically.
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";
import type { ControlLimits } from "@/lib/analytics/control-chart";

/** ChartCard's ResponsiveContainer injects these. */
interface SizeProps {
  width?: number;
  height?: number;
}

const axisTick = { fill: chartTheme.axisColor, fontSize: 11 };

/** Median working hours per PR size band: first review and merge side by side. */
export function BandChart({
  data,
}: {
  data: Array<{ band: string; firstReview: number | null; cycle: number | null }>;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} vertical={false} />
        <XAxis dataKey="band" tick={axisTick} axisLine={false} tickLine={false} />
        <YAxis tick={axisTick} axisLine={false} tickLine={false} unit="h" />
        <Tooltip contentStyle={chartTheme.tooltipStyle} />
        <Legend wrapperStyle={chartTheme.legendStyle} />
        <Bar
          dataKey="firstReview"
          name="Median first review (working h)"
          fill={chartTheme.colors.cyan}
          radius={[4, 4, 0, 0]}
        />
        <Bar
          dataKey="cycle"
          name="Median cycle (working h)"
          fill={chartTheme.colors.purple}
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * The median working cycle per merge week; a week with too few merges for
 * a median is a gap. With `control`, its XmR limits (Advanced analysis).
 */
export function WeeklyMedianChart({
  data,
  control,
}: {
  data: Array<{ week: string; median: number | null }>;
  control?: ControlLimits | null;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} vertical={false} />
        <XAxis dataKey="week" tick={axisTick} axisLine={false} tickLine={false} />
        <YAxis tick={axisTick} axisLine={false} tickLine={false} unit="h" />
        <Tooltip contentStyle={chartTheme.tooltipStyle} />
        {control && (
          <>
            <ReferenceLine
              y={control.centerLine}
              stroke={chartTheme.colors.cyan}
              strokeDasharray="2 4"
              strokeOpacity={0.55}
              label={{ value: "X̄", fill: chartTheme.colors.cyan, fontSize: 11, position: "right" }}
              ifOverflow="extendDomain"
            />
            <ReferenceLine
              y={control.ucl}
              stroke={chartTheme.colors.red}
              strokeDasharray="2 4"
              strokeOpacity={0.55}
              label={{ value: "UCL", fill: chartTheme.colors.red, fontSize: 11, position: "right" }}
              ifOverflow="extendDomain"
            />
          </>
        )}
        <Line
          type="monotone"
          dataKey="median"
          name="Median cycle (working h)"
          stroke={chartTheme.colors.cyan}
          strokeWidth={2}
          dot={{ r: 3, fill: chartTheme.colors.cyan }}
          connectNulls={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function PrSizeScatterChart({
  data,
  width,
  height,
}: SizeProps & {
  data: Array<{ linesChanged: number; cycleWorkingH: number; label: string }>;
}) {
  return (
    <ScatterChart
      width={width}
      height={height}
      margin={{ top: 10, right: 16, left: 0, bottom: 10 }}
    >
      <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} />
      <XAxis
        type="number"
        dataKey="linesChanged"
        name="Lines changed"
        tick={axisTick}
        axisLine={{ stroke: chartTheme.gridColor }}
        tickLine={false}
      />
      <YAxis
        type="number"
        dataKey="cycleWorkingH"
        name="Working hours to merge"
        unit="h"
        tick={axisTick}
        axisLine={false}
        tickLine={false}
      />
      <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={chartTheme.tooltipStyle} />
      <Scatter data={data} fill={chartTheme.colors.cyan} />
    </ScatterChart>
  );
}
