"use client";

// Recharts lives here so the DORA scorecard loads it only when the trend
// chart mounts. Import this module through next/dynamic, never statically.
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

export interface DoraTrendRow {
  quarter: string;
  deployFreqPerWeek: number;
  leadTimeHours: number;
  changeFailRatePct: number;
  mttrHours: number;
}

export function DoraTrendChart({
  data,
  deployControl,
  deployChangepoints,
  width,
  height,
}: {
  data: DoraTrendRow[];
  deployControl: ControlLimits | null;
  deployChangepoints: CausalAnnotationData[];
  /** Injected by ChartCard's ResponsiveContainer. */
  width?: number;
  height?: number;
}) {
  return (
    <LineChart
      width={width}
      height={height}
      data={data}
      margin={{ top: 8, right: 12, left: -16, bottom: 4 }}
      // ChartCard hides the plot from assistive tech behind its summary and
      // table, so the SVG mustn't be a tab stop.
      accessibilityLayer={false}
    >
      <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" />
      <XAxis dataKey="quarter" tick={{ fill: chartTheme.axisColor, fontSize: 11 }} />
      {/* Left axis: deploy frequency (per week) and lead time (hours). */}
      <YAxis yAxisId="left" tick={{ fill: chartTheme.axisColor, fontSize: 11 }} />
      {/* Right axis: CFR (%) and MTTR (hours) — distinct scales/units. */}
      <YAxis
        yAxisId="right"
        orientation="right"
        tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
      />
      <Tooltip contentStyle={chartTheme.tooltipStyle} />
      <Legend wrapperStyle={chartTheme.legendStyle} />
      <Line
        yAxisId="left"
        type="monotone"
        dataKey="deployFreqPerWeek"
        name="Deploy/wk"
        stroke={chartTheme.colors.cyan}
        strokeWidth={2}
        dot={{ r: 3 }}
      />
      <Line
        yAxisId="left"
        type="monotone"
        dataKey="leadTimeHours"
        name="Lead (h)"
        stroke={chartTheme.colors.amber}
        strokeWidth={2}
        dot={{ r: 3 }}
      />
      <Line
        yAxisId="right"
        type="monotone"
        dataKey="changeFailRatePct"
        name="CFR (%)"
        stroke={chartTheme.colors.red}
        strokeWidth={2}
        dot={{ r: 3 }}
      />
      <Line
        yAxisId="right"
        type="monotone"
        dataKey="mttrHours"
        name="MTTR (h)"
        stroke={chartTheme.colors.purple}
        strokeWidth={2}
        dot={{ r: 3 }}
      />
      {/* XmR control limits on deploy frequency — most actionable SPC. */}
      {deployControl && (
        <>
          <ReferenceLine
            yAxisId="left"
            y={deployControl.centerLine}
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
            yAxisId="left"
            y={deployControl.ucl}
            stroke={chartTheme.colors.green}
            strokeDasharray="2 4"
            strokeOpacity={0.55}
            label={{
              value: "UCL",
              fill: chartTheme.colors.green,
              fontSize: 10,
              position: "right",
            }}
            ifOverflow="extendDomain"
          />
          <ReferenceLine
            yAxisId="left"
            y={deployControl.lcl}
            stroke={chartTheme.colors.red}
            strokeDasharray="2 4"
            strokeOpacity={0.55}
            label={{
              value: "LCL",
              fill: chartTheme.colors.red,
              fontSize: 10,
              position: "right",
            }}
            ifOverflow="extendDomain"
          />
        </>
      )}
      {/* CUSUM regime-shift markers on the deploy series. */}
      {deployChangepoints.map((cp, i) => (
        <CausalLine key={`cusum-${i}`} annotation={cp} />
      ))}
    </LineChart>
  );
}
