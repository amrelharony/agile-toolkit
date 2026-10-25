"use client";

// Recharts lives here so the feature-flag tracker loads it only when a
// chart mounts. Import this module through next/dynamic, never statically.
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";
import type { SurvivalCurvePoint } from "@/lib/analytics/survival";
import type { AgeBucket } from "./analysis";

/** Kaplan-Meier curve: the share of flags still live after N days. */
export function FlagSurvivalChart({ data }: { data: readonly SurvivalCurvePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={[...data]} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
        <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" />
        <XAxis
          dataKey="t"
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          tickFormatter={(v) => `${v}d`}
        />
        <YAxis
          domain={[0, 1]}
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          tickFormatter={(v) => `${Math.round(v * 100)}%`}
        />
        <Tooltip
          contentStyle={chartTheme.tooltipStyle}
          formatter={(v) => [`${(Number(v) * 100).toFixed(0)}%`, "Still live"]}
          labelFormatter={(v) => `${v} days`}
        />
        <Line
          type="stepAfter"
          dataKey="survival"
          stroke={chartTheme.colors.cyan}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Live flags by age band. */
export function FlagAgeChart({ data }: { data: readonly AgeBucket[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={[...data]} margin={{ top: 10, right: 12, left: -8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} vertical={false} />
        <XAxis
          dataKey="bucket"
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          interval={0}
          tickFormatter={(v: string) => v.replace(" days", "d").replace("Over ", ">")}
        />
        <YAxis
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={chartTheme.tooltipStyle}
          formatter={(v) => [String(v), "Live flags"]}
        />
        <Bar
          dataKey="count"
          name="Live flags"
          fill={chartTheme.colors.cyan}
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
