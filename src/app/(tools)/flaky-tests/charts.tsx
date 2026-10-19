"use client";

// Recharts lives here so the flaky-tests page loads it only when a chart
// mounts. Import this module through next/dynamic, never statically.
import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
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

export function FlakiestTestsChart({
  data,
  width,
  height,
}: SizeProps & {
  data: Array<{ name: string; failureRatePct: number; flagged: boolean }>;
}) {
  return (
    <BarChart
      width={width}
      height={height}
      data={data}
      margin={{ top: 10, right: 16, left: 0, bottom: 60 }}
    >
      <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} vertical={false} />
      <XAxis
        dataKey="name"
        tick={{ fill: chartTheme.axisColor, fontSize: 10 }}
        axisLine={{ stroke: chartTheme.gridColor }}
        tickLine={false}
        angle={-30}
        textAnchor="end"
        interval={0}
        height={60}
      />
      <YAxis
        tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
        axisLine={false}
        tickLine={false}
        unit="%"
      />
      <Tooltip contentStyle={chartTheme.tooltipStyle} />
      <Bar dataKey="failureRatePct" name="Failure rate" radius={[4, 4, 0, 0]}>
        {data.map((d, i) => (
          <Cell key={`cell-${i}`} fill={d.flagged ? "#ef4444" : "#00f0ff"} />
        ))}
      </Bar>
    </BarChart>
  );
}

export function WeeklyFlakiesChart({
  data,
  control,
  width,
  height,
}: SizeProps & {
  data: Array<{ week: string; count: number }>;
  control: ControlLimits;
}) {
  return (
    <LineChart
      width={width}
      height={height}
      data={data}
      margin={{ top: 8, right: 12, left: -12, bottom: 0 }}
    >
      <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} vertical={false} />
      <XAxis
        dataKey="week"
        tick={{ fill: chartTheme.axisColor, fontSize: 10 }}
        axisLine={false}
        tickLine={false}
      />
      <YAxis
        tick={{ fill: chartTheme.axisColor, fontSize: 10 }}
        axisLine={false}
        tickLine={false}
        allowDecimals={false}
      />
      <Tooltip contentStyle={chartTheme.tooltipStyle} />
      <ReferenceLine
        y={control.centerLine}
        stroke={chartTheme.colors.cyan}
        strokeDasharray="2 4"
        strokeOpacity={0.55}
        label={{ value: "X̄", fill: chartTheme.colors.cyan, fontSize: 10, position: "right" }}
        ifOverflow="extendDomain"
      />
      <ReferenceLine
        y={control.ucl}
        stroke={chartTheme.colors.red}
        strokeDasharray="2 4"
        strokeOpacity={0.55}
        label={{ value: "UCL", fill: chartTheme.colors.red, fontSize: 10, position: "right" }}
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
      <Line
        type="monotone"
        dataKey="count"
        name="Flakies"
        stroke={chartTheme.colors.cyan}
        strokeWidth={2}
        dot={{ fill: chartTheme.colors.cyan, r: 3 }}
        activeDot={{ r: 5 }}
      />
    </LineChart>
  );
}
