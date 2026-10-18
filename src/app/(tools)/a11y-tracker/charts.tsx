"use client";

// Recharts lives here so the a11y tracker loads it only when the chart
// mounts. Import this module through next/dynamic, never statically.
import {
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";
import { CausalLine, type CausalAnnotationData } from "@/components/charts/causal-annotation";
import type { ControlLimits } from "@/lib/analytics/control-chart";
import type { A11ySeverity } from "@/lib/stores/workspace-types";

export interface A11yOpenIssuesRow {
  date: string;
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
  total: number;
}

interface A11yOpenIssuesChartProps {
  data: A11yOpenIssuesRow[];
  severityColor: Record<A11ySeverity, string>;
  control: ControlLimits | null;
  changepoints: CausalAnnotationData[];
  /** Injected by ChartCard's ResponsiveContainer. */
  width?: number;
  height?: number;
}

export function A11yOpenIssuesChart({
  data,
  severityColor,
  control,
  changepoints,
  width,
  height,
}: A11yOpenIssuesChartProps) {
  return (
    <LineChart
      width={width}
      height={height}
      data={data}
      margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
    >
      <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} vertical={false} />
      <XAxis
        dataKey="date"
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
      <Legend wrapperStyle={chartTheme.legendStyle} />
      <Line
        type="monotone"
        dataKey="critical"
        stroke={severityColor.critical}
        strokeWidth={2}
        dot={false}
        name="Critical"
      />
      <Line
        type="monotone"
        dataKey="serious"
        stroke={severityColor.serious}
        strokeWidth={2}
        dot={false}
        name="Serious"
      />
      <Line
        type="monotone"
        dataKey="moderate"
        stroke={severityColor.moderate}
        strokeWidth={2}
        dot={false}
        name="Moderate"
      />
      <Line
        type="monotone"
        dataKey="minor"
        stroke={severityColor.minor}
        strokeWidth={2}
        dot={false}
        name="Minor"
      />
      <Line
        type="monotone"
        dataKey="total"
        stroke={chartTheme.colors.cyan}
        strokeWidth={1.5}
        strokeOpacity={0.55}
        dot={false}
        name="Total open"
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
      {changepoints.map((cp, i) => (
        <CausalLine key={`cusum-${i}`} annotation={cp} />
      ))}
    </LineChart>
  );
}
