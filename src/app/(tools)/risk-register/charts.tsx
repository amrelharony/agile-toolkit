"use client";

// Recharts lives here so the Risk Register route loads it only when the
// chart mounts. risk-register-client.tsx imports this via next/dynamic.
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";

export interface OpenRiskPoint {
  /** "Week 42". */
  week: string;
  raised: number;
  open: number;
}

/**
 * Risks raised each week (bars) and still open at each week's end (the
 * line), oldest first. The legend and the table name both series, so the
 * colour is never the only cue.
 */
export function OpenRisksChart({ data }: { data: OpenRiskPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      {/* ChartFigure hides the plot behind its summary and table, so the SVG
          mustn't be a tab stop. */}
      <ComposedChart
        data={data}
        margin={{ top: 10, right: 12, left: -20, bottom: 0 }}
        accessibilityLayer={false}
      >
        <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="week"
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
        />
        <Tooltip contentStyle={chartTheme.tooltipStyle} />
        <Legend wrapperStyle={chartTheme.legendStyle} />
        <Bar dataKey="raised" name="Raised" fill={chartTheme.colors.purple} radius={[3, 3, 0, 0]} />
        <Line
          dataKey="open"
          name="Open at week end"
          stroke={chartTheme.colors.cyan}
          strokeWidth={2}
          dot={{ fill: chartTheme.colors.cyan, r: 3 }}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
