"use client";

// Recharts lives here so the flaky-tests page loads it only when a chart
// mounts. Import this module through next/dynamic, never statically.
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
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

const shortName = (name: string) => (name.length > 24 ? `${name.slice(0, 23)}…` : name);

/** The worst offenders as horizontal bars, so long test names fit a phone. */
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
      data={data.map((d) => ({ ...d, label: shortName(d.name) }))}
      layout="vertical"
      margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
    >
      <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} horizontal={false} />
      <XAxis
        type="number"
        unit="%"
        domain={[0, 100]}
        tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
        axisLine={false}
        tickLine={false}
      />
      <YAxis
        type="category"
        dataKey="label"
        width={120}
        tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
        axisLine={false}
        tickLine={false}
      />
      <Tooltip contentStyle={chartTheme.tooltipStyle} formatter={(v) => `${v}%`} />
      <Bar dataKey="failureRatePct" name="Failure rate" radius={[0, 4, 4, 0]}>
        {data.map((d, i) => (
          <Cell
            key={`cell-${i}`}
            fill={d.flagged ? chartTheme.colors.red : chartTheme.colors.cyan}
          />
        ))}
      </Bar>
    </BarChart>
  );
}

/** New flaky tests per week (quiet weeks as 0). */
export function WeeklyNewChart({
  data,
  width,
  height,
}: SizeProps & { data: Array<{ week: string; count: number }> }) {
  return (
    <BarChart
      width={width}
      height={height}
      data={data}
      margin={{ top: 8, right: 12, left: -12, bottom: 0 }}
    >
      <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} vertical={false} />
      <XAxis
        dataKey="week"
        tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
        axisLine={false}
        tickLine={false}
      />
      <YAxis
        allowDecimals={false}
        tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
        axisLine={false}
        tickLine={false}
      />
      <Tooltip contentStyle={chartTheme.tooltipStyle} />
      <Bar
        dataKey="count"
        name="New flaky tests"
        fill={chartTheme.colors.cyan}
        radius={[4, 4, 0, 0]}
      />
    </BarChart>
  );
}

/** The weekly count with its XmR limits (Advanced analysis). */
export function WeeklyControlChart({
  data,
  control,
}: {
  data: Array<{ week: string; count: number }>;
  control: ControlLimits;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} vertical={false} />
        <XAxis
          dataKey="week"
          tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip contentStyle={chartTheme.tooltipStyle} />
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
        <ReferenceLine
          y={control.lcl}
          stroke={chartTheme.colors.green}
          strokeDasharray="2 4"
          strokeOpacity={0.55}
          label={{ value: "LCL", fill: chartTheme.colors.green, fontSize: 11, position: "right" }}
          ifOverflow="extendDomain"
        />
        <Line
          type="monotone"
          dataKey="count"
          name="New flaky tests"
          stroke={chartTheme.colors.cyan}
          strokeWidth={2}
          dot={{ fill: chartTheme.colors.cyan, r: 3 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
