"use client";

// Recharts lives here so the cycle-time page loads it only when a chart
// mounts. Import this module through next/dynamic, never statically.
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  Label as RechartsLabel,
} from "recharts";
import { CausalLine, type CausalAnnotationData } from "@/components/charts/causal-annotation";
import { chartTheme } from "@/components/charts/chart-theme";
import { isoFromDayNumber } from "@/lib/sprints/calendar";
import type { HistogramDatum, ScatterDatum } from "./types";
import type { QuotedPercentiles } from "./chart-text";
import { BUCKETS } from "./helpers";
import { HistogramTooltip, ScatterTooltip } from "./components/chart-tooltips";

const { colors } = chartTheme;

/** The percentile lines, in the theme's colours: median, the usual SLE, the near-worst case. */
const MARKERS = [
  { key: "median", label: "P50", color: colors.cyan },
  { key: "p85", label: "P85", color: colors.amber },
  { key: "p95", label: "P95", color: colors.red },
] as const;

/** "5 Oct" for a day number on the time axis. */
export function shortDay(n: number): string {
  const [y, m, d] = isoFromDayNumber(n).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Cycle-time distribution across fixed day-buckets with P50/P85/P95 markers. */
export function CycleTimeHistogramChart({
  histogramData,
  stats,
}: {
  histogramData: HistogramDatum[];
  stats: QuotedPercentiles;
}) {
  return (
    <ResponsiveContainer width="100%" height={380}>
      {/* ChartFigure hides the plot from assistive tech behind its summary and
          table, so the SVG mustn't be a tab stop. */}
      <BarChart
        data={histogramData}
        margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
        accessibilityLayer={false}
      >
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} />
        <XAxis
          dataKey="bucket"
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          tickLine={false}
          allowDecimals={false}
          label={{
            value: "Items",
            angle: -90,
            position: "insideLeft",
            fill: chartTheme.axisColor,
            fontSize: 12,
          }}
        />
        <Tooltip content={<HistogramTooltip />} />
        <Bar dataKey="count" fill={colors.cyan} fillOpacity={0.8} radius={[4, 4, 0, 0]} />
        {/* A marker only where its percentile lands in a bucket (and once it may be quoted). */}
        {MARKERS.map((m) => {
          const v = stats[m.key];
          const bucket = v === null ? undefined : BUCKETS.find((b) => v >= b.min && v <= b.max);
          return bucket ? (
            <ReferenceLine
              key={m.key}
              x={bucket.label}
              stroke={m.color}
              strokeDasharray="4 2"
              label={{ value: m.label, fill: m.color, fontSize: 12 }}
            />
          ) : null;
        })}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Each item's cycle time at its finish date, with percentile and CUSUM markers. */
export function CycleTimeScatterChart({
  scatterData,
  stats,
  cusumAnnotations,
}: {
  scatterData: ScatterDatum[];
  stats: QuotedPercentiles;
  cusumAnnotations: CausalAnnotationData[];
}) {
  return (
    <ResponsiveContainer width="100%" height={380}>
      {/* ChartFigure hides the plot from assistive tech (see above). */}
      <ScatterChart margin={{ top: 10, right: 20, left: 0, bottom: 20 }} accessibilityLayer={false}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} />
        <XAxis
          dataKey="x"
          type="number"
          name="Finished"
          domain={["dataMin", "dataMax"]}
          tickFormatter={shortDay}
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          tickLine={false}
          allowDecimals={false}
        >
          <RechartsLabel
            value="Finished"
            offset={-10}
            position="insideBottom"
            fill={chartTheme.axisColor}
            fontSize={12}
          />
        </XAxis>
        <YAxis
          dataKey="cycleTime"
          type="number"
          name="Days"
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          tickLine={false}
          label={{
            value: "Cycle time (days)",
            angle: -90,
            position: "insideLeft",
            fill: chartTheme.axisColor,
            fontSize: 12,
          }}
        />
        <Tooltip content={<ScatterTooltip />} />
        {MARKERS.map((m) => {
          const v = stats[m.key];
          return v === null ? null : (
            <ReferenceLine
              key={m.key}
              y={v}
              stroke={m.color}
              strokeDasharray="5 3"
              label={{
                value: `${m.label} (${v}d)`,
                fill: m.color,
                fontSize: 12,
                position: "right",
              }}
            />
          );
        })}
        {cusumAnnotations.map((a, i) => (
          <CausalLine key={i} annotation={a} />
        ))}
        <Scatter data={scatterData} fill={colors.cyan} fillOpacity={0.8} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}
