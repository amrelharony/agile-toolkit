"use client";

// Recharts lives here so the OKRs page loads it only when a confidence
// chart mounts. Import this module through next/dynamic.
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";
import type { ConfidencePoint } from "@/lib/okrs/progress";
import { dayLabel } from "./chart-text";

const { colors } = chartTheme;

/**
 * An objective's confidence over time (0–10), one point per check-in day.
 * The two dashed lines are the band edges the badges use (lib/okrs
 * confidenceBand): at or below 3 off track, at or above 7 on track. The
 * table and the summary name the numbers, so colour is never the only cue.
 */
export function ConfidenceTrendChart({ data }: { data: ConfidencePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      {/* ChartFigure hides the plot behind its summary and table, so the SVG
          mustn't be a tab stop. */}
      <LineChart
        data={data}
        margin={{ top: 8, right: 12, left: -20, bottom: 0 }}
        accessibilityLayer={false}
      >
        <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={(d: string) => dayLabel(d).replace(/ \d{4}$/, "")}
          tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          domain={[0, 10]}
          ticks={[0, 3, 7, 10]}
          tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={chartTheme.tooltipStyle}
          labelFormatter={(d) => dayLabel(String(d))}
          formatter={(value, _name, item) => {
            const scored = (item?.payload as ConfidencePoint | undefined)?.scored;
            return [`${value}/10${scored ? ` (${scored} scored)` : ""}`, "Confidence"];
          }}
        />
        <ReferenceLine y={3} stroke={colors.red} strokeDasharray="2 4" strokeOpacity={0.5} />
        <ReferenceLine y={7} stroke={colors.green} strokeDasharray="2 4" strokeOpacity={0.5} />
        <Line
          type="monotone"
          dataKey="confidence"
          name="Confidence"
          stroke={colors.cyan}
          strokeWidth={2}
          dot={{ r: 3 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
