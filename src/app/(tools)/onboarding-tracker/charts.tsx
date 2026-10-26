"use client";

// Recharts lives here so the Onboarding Tracker page loads it only when the
// ramp curve mounts. Import this module through next/dynamic.
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";
import type { RampPoint } from "./model";

/**
 * The average share of milestones reached by each day since the start. A
 * day too few people have reached has no point (a gap, not a dip).
 */
export function RampCurveChart({ data }: { data: RampPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      {/* ChartFigure hides the plot behind its summary and table, so the SVG
          mustn't be a tab stop. */}
      <LineChart data={data} accessibilityLayer={false}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} />
        <XAxis
          dataKey="day"
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          tickFormatter={(v) => `${v}d`}
          axisLine={{ stroke: chartTheme.gridColor }}
        />
        <YAxis
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          domain={[0, 100]}
          tickFormatter={(v) => `${v}%`}
        />
        <Tooltip
          contentStyle={chartTheme.tooltipStyle}
          labelFormatter={(v, payload) => {
            const reached = (payload?.[0]?.payload as RampPoint | undefined)?.reached;
            return reached ? `Day ${v} · ${reached} people` : `Day ${v}`;
          }}
          formatter={(v) => [typeof v === "number" ? `${v.toFixed(1)}%` : String(v), "% complete"]}
        />
        <Line
          type="monotone"
          dataKey="avgPct"
          stroke={chartTheme.colors.cyan}
          strokeWidth={2}
          dot={false}
          connectNulls={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
