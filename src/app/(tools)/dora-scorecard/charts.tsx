"use client";

// Recharts lives here so the DORA scorecard loads it only when a trend
// chart mounts. Import this module through next/dynamic, never statically.
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
import { DORA_BANDS, type DoraMetric } from "@/lib/dora/bands";
import { plotted, type DoraTrendRow } from "./chart-text";

const { colors } = chartTheme;

/** Each metric keeps one theme colour across its chart, its legend and the KPI tiles. */
const STROKE: Record<DoraMetric, string> = {
  deployFreqPerWeek: colors.cyan,
  leadTimeHours: colors.amber,
  changeFailRate: colors.red,
  mttrHours: colors.purple,
};

const BOUNDARIES = [
  { key: "elite", label: "Elite" },
  { key: "high", label: "High" },
  { key: "medium", label: "Medium" },
] as const;

/**
 * One DORA metric across the quarters, in its own unit (the old chart put
 * deploys a week and lead-time hours on one axis, which flattened the
 * deploy line), with the band boundaries of the cited report as dashed
 * lines where they fall inside the plotted range.
 */
export function MetricTrendChart({ metric, data }: { metric: DoraMetric; data: DoraTrendRow[] }) {
  const points = data.map((r) => ({ quarter: r.quarter, value: plotted(r, metric) }));
  const scale = metric === "changeFailRate" ? 100 : 1;
  const cuts = DORA_BANDS.cut[metric];
  return (
    <ResponsiveContainer width="100%" height={180}>
      {/* ChartFigure hides the plot behind its summary and table, so the SVG
          mustn't be a tab stop. */}
      <LineChart
        data={points}
        margin={{ top: 8, right: 44, left: -12, bottom: 0 }}
        accessibilityLayer={false}
      >
        <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="quarter"
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          width={48}
        />
        <Tooltip contentStyle={chartTheme.tooltipStyle} />
        {BOUNDARIES.map((b) => (
          <ReferenceLine
            key={b.key}
            y={cuts[b.key] * scale}
            stroke={chartTheme.axisColor}
            strokeDasharray="2 4"
            strokeOpacity={0.6}
            // Only the boundaries inside the plotted range: a month of lead
            // time would squash a team that ships in days into the floor.
            ifOverflow="hidden"
            label={{
              value: b.label,
              fill: chartTheme.axisColor,
              fontSize: 12,
              position: "right",
            }}
          />
        ))}
        <Line
          type="monotone"
          dataKey="value"
          name="Value"
          stroke={STROKE[metric]}
          strokeWidth={2}
          dot={{ r: 3 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
