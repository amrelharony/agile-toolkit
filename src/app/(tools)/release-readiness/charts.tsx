"use client";

// Recharts lives here so the Release Readiness route loads it only when a
// chart mounts. release-readiness-client.tsx imports these via next/dynamic.
import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  ReferenceLine,
} from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";
import type { PassControl, PassPoint, SkippedRow } from "./analysis";

const { colors } = chartTheme;

/**
 * Each ship's gate-pass rate against its p-chart limits. The centre line
 * and limits are labelled, so colour isn't the only cue.
 */
export function GatePassControlChart({
  data,
  control,
}: {
  data: readonly PassPoint[];
  control: PassControl;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={[...data]} margin={{ top: 8, right: 28, left: -12, bottom: 0 }}>
        <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="label"
          tick={false}
          axisLine={{ stroke: chartTheme.gridColor }}
          tickLine={false}
          height={8}
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `${v}%`}
        />
        <Tooltip
          contentStyle={chartTheme.tooltipStyle}
          formatter={(v) => [`${Number(v).toFixed(0)}%`, "Pass rate"]}
        />
        <ReferenceLine
          y={control.centerLinePct}
          stroke={colors.cyan}
          strokeDasharray="2 4"
          label={{ value: "Mean", fill: chartTheme.axisColor, fontSize: 12, position: "right" }}
          ifOverflow="extendDomain"
        />
        <ReferenceLine
          y={control.uclPct}
          stroke={colors.green}
          strokeDasharray="2 4"
          label={{ value: "UCL", fill: chartTheme.axisColor, fontSize: 12, position: "right" }}
          ifOverflow="extendDomain"
        />
        <ReferenceLine
          y={control.lclPct}
          stroke={colors.red}
          strokeDasharray="2 4"
          label={{ value: "LCL", fill: chartTheme.axisColor, fontSize: 12, position: "right" }}
          ifOverflow="extendDomain"
        />
        <Line
          type="monotone"
          dataKey="passRatePct"
          name="Pass rate"
          stroke={colors.cyan}
          strokeWidth={2}
          dot={{ fill: colors.cyan, r: 3 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/**
 * How often each gate was open at ship, as horizontal bars: the gate names
 * read across, so nine of them fit a phone without angled labels.
 */
export function SkippedGatesChart({ data }: { data: readonly SkippedRow[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={[...data]}
        layout="vertical"
        margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
      >
        <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" horizontal={false} />
        <XAxis
          type="number"
          allowDecimals={false}
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={{ stroke: chartTheme.gridColor }}
        />
        <YAxis
          type="category"
          dataKey="label"
          width={120}
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          tickLine={false}
          interval={0}
        />
        <Tooltip
          contentStyle={chartTheme.tooltipStyle}
          formatter={(v) => [String(v), "Open at ship"]}
        />
        <Bar dataKey="skipped" name="Open at ship" fill={colors.amber} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
