"use client";

// Recharts lives here so the code-review page loads it only when a chart
// mounts. Import this module through next/dynamic, never statically.
import {
  ScatterChart,
  Scatter,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
  LineChart,
  Line,
  ReferenceLine,
} from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";
import type { ControlLimits } from "@/lib/analytics/control-chart";

/** ChartCard's ResponsiveContainer injects these. */
interface SizeProps {
  width?: number;
  height?: number;
}

export function WeeklyCycleTimeChart({
  data,
  control,
  width,
  height,
}: SizeProps & {
  data: Array<{ week: string; meanHours: number }>;
  control: ControlLimits | null;
}) {
  return (
    <LineChart
      width={width}
      height={height}
      data={data}
      margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
    >
      <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} vertical={false} />
      <XAxis
        dataKey="week"
        tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
        axisLine={{ stroke: chartTheme.gridColor }}
        tickLine={false}
      />
      <YAxis
        tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
        axisLine={false}
        tickLine={false}
        label={{
          value: "Hours",
          angle: -90,
          position: "insideLeft",
          fill: chartTheme.axisColor,
          fontSize: 11,
        }}
      />
      <Tooltip contentStyle={chartTheme.tooltipStyle} />
      <Line
        type="monotone"
        dataKey="meanHours"
        stroke={chartTheme.colors.cyan}
        strokeWidth={2}
        dot={{ r: 3 }}
        name="Mean cycle (h)"
      />
      {control && (
        <>
          <ReferenceLine
            y={control.centerLine}
            stroke={chartTheme.colors.cyan}
            strokeDasharray="2 4"
            strokeOpacity={0.55}
            label={{
              value: "X̄",
              fill: chartTheme.colors.cyan,
              fontSize: 10,
              position: "right",
            }}
            ifOverflow="extendDomain"
          />
          <ReferenceLine
            y={control.ucl}
            stroke={chartTheme.colors.red}
            strokeDasharray="2 4"
            strokeOpacity={0.55}
            label={{
              value: "UCL",
              fill: chartTheme.colors.red,
              fontSize: 10,
              position: "right",
            }}
            ifOverflow="extendDomain"
          />
          <ReferenceLine
            y={control.lcl}
            stroke={chartTheme.colors.green}
            strokeDasharray="2 4"
            strokeOpacity={0.55}
            label={{
              value: "LCL",
              fill: chartTheme.colors.green,
              fontSize: 10,
              position: "right",
            }}
            ifOverflow="extendDomain"
          />
        </>
      )}
    </LineChart>
  );
}

export function PrSizeScatterChart({
  data,
  width,
  height,
}: SizeProps & {
  data: Array<{
    linesChanged: number;
    cycleHours: number;
    prNumber: string | number;
    author: string;
  }>;
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
        tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
        axisLine={{ stroke: chartTheme.gridColor }}
        tickLine={false}
      />
      <YAxis
        type="number"
        dataKey="cycleHours"
        name="Cycle hours"
        tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
        axisLine={false}
        tickLine={false}
      />
      <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={chartTheme.tooltipStyle} />
      <Scatter data={data} fill="#00f0ff" />
    </ScatterChart>
  );
}

export function TopAuthorsChart({
  data,
  width,
  height,
}: SizeProps & { data: Array<{ author: string; comments: number }> }) {
  return (
    <BarChart
      width={width}
      height={height}
      data={data}
      margin={{ top: 10, right: 16, left: 0, bottom: 10 }}
    >
      <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} vertical={false} />
      <XAxis
        dataKey="author"
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
      <Bar dataKey="comments" fill="#ff00aa" radius={[4, 4, 0, 0]} />
    </BarChart>
  );
}
