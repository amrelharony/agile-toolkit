"use client";

// Recharts lives here so the cumulative-flow page loads it only when a
// chart mounts. Import this module through next/dynamic, never statically.
import {
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
  ReferenceDot,
  ResponsiveContainer,
  LineChart,
  Line,
} from "recharts";
import { CausalLine, type CausalAnnotationData } from "@/components/charts/causal-annotation";
import { chartTheme } from "@/components/charts/chart-theme";
import { isoDayNumber } from "@/lib/sprints/calendar";
import type { FlowDay, FlowStage } from "@/lib/flow";
import type { WipLimits, WipSeriesPoint, WipSignal } from "./types";
import { CFDTooltip } from "./components/cfd-tooltip";
import { shortDay, stageColors } from "./stage-colors";

const { colors } = chartTheme;

/**
 * The stacked cumulative-flow area chart: one band per stage, keyed by
 * stage id. Recharts stacks areas in render order, first at the bottom; a
 * CFD puts Done at the bottom and the first (waiting) stage on top, so the
 * stages render in reverse board order while the legend keeps board order.
 *
 * The x axis is time, not a list of dates: typed snapshots on 1, 2 and 30
 * October sit 28 days apart, as they were.
 *
 * There's no WIP-limit line here: the stack's height is every item on the
 * board, not the WIP band, so a limit drawn against it reads wrong. The limit
 * is drawn on the WIP control chart instead.
 */
export function CumulativeFlowAreaChart({
  days,
  stages,
}: {
  days: readonly FlowDay[];
  stages: readonly FlowStage[];
}) {
  const data = days.map((d) => ({ x: isoDayNumber(d.date), date: d.date, ...d.counts }));
  const fills = stageColors(stages);
  const order = stages.map((s, i) => ({ stage: s, fill: fills[i] })).reverse();
  const workflowIndex = (label: unknown) => stages.findIndex((s) => s.label === label);
  return (
    <ResponsiveContainer width="100%" height={400}>
      {/* ChartFigure hides the plot from assistive tech behind its summary and
          table, so the SVG mustn't be a tab stop. */}
      <AreaChart
        data={data}
        margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
        accessibilityLayer={false}
      >
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} />
        <XAxis
          dataKey="x"
          type="number"
          domain={["dataMin", "dataMax"]}
          allowDecimals={false}
          tickFormatter={shortDay}
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          tickLine={false}
          allowDecimals={false}
        />
        <Tooltip content={<CFDTooltip formatLabel={shortDay} />} />
        <Legend
          wrapperStyle={{ ...chartTheme.legendStyle, paddingTop: 12 }}
          itemSorter={(item) => workflowIndex(item.value)}
        />
        {order.map(({ stage, fill }) => (
          <Area
            key={stage.id}
            type="monotone"
            dataKey={stage.id}
            name={stage.label}
            stackId="1"
            stroke={fill}
            fill={fill}
            fillOpacity={0.55}
            strokeWidth={2}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

/**
 * WIP over time with XmR limits, CUSUM markers and out-of-control dots, plus
 * the team's WIP limit when one is set (drawn on the series it limits).
 */
export function WipControlLineChart({
  wipSeries,
  wipLimits,
  wipLimit = null,
  cusumAnnotations,
  signals,
}: {
  wipSeries: WipSeriesPoint[];
  wipLimits: WipLimits | null;
  wipLimit?: number | null;
  cusumAnnotations: CausalAnnotationData[];
  signals: WipSignal[];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      {/* ChartFigure hides the plot from assistive tech (see above). */}
      <LineChart
        data={wipSeries}
        margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
        accessibilityLayer={false}
      >
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} />
        <XAxis
          dataKey="date"
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          tickLine={false}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={chartTheme.tooltipStyle}
          labelStyle={{ color: chartTheme.axisColor }}
        />
        {wipLimits && (
          <>
            <ReferenceLine
              y={wipLimits.centerLine}
              stroke={chartTheme.axisColor}
              strokeDasharray="2 4"
              label={{
                value: `X̄ ${wipLimits.centerLine.toFixed(1)}`,
                fill: chartTheme.axisColor,
                fontSize: 12,
                position: "right",
              }}
            />
            <ReferenceLine
              y={wipLimits.ucl}
              stroke={colors.red}
              strokeDasharray="4 2"
              label={{
                value: `UCL ${wipLimits.ucl.toFixed(1)}`,
                fill: colors.red,
                fontSize: 12,
                position: "right",
              }}
            />
            <ReferenceLine
              y={wipLimits.lcl}
              stroke={colors.red}
              strokeDasharray="4 2"
              label={{
                value: `LCL ${wipLimits.lcl.toFixed(1)}`,
                fill: colors.red,
                fontSize: 12,
                position: "right",
              }}
            />
          </>
        )}
        {wipLimit !== null && (
          <ReferenceLine
            y={wipLimit}
            stroke={colors.amber}
            strokeDasharray="6 3"
            ifOverflow="extendDomain"
            label={{
              value: `WIP limit ${wipLimit}`,
              fill: colors.amber,
              fontSize: 12,
              position: "insideTopLeft",
            }}
          />
        )}
        {cusumAnnotations.map((a, i) => (
          <CausalLine key={i} annotation={a} />
        ))}
        {/* Western Electric out-of-control markers: a dot at the offending
            sample, with the rule that fired as its SVG title. */}
        {signals.map((sig) => {
          const point = wipSeries[sig.index];
          if (!point) return null;
          return (
            <ReferenceDot
              key={`we-${sig.index}-${sig.rule}`}
              x={point.date}
              y={point.value}
              r={4}
              fill="var(--destructive)"
              stroke="var(--destructive)"
              ifOverflow="extendDomain"
            >
              <title>{`${sig.rule}: ${sig.description}`}</title>
            </ReferenceDot>
          );
        })}
        <Line
          type="monotone"
          dataKey="value"
          stroke={colors.cyan}
          strokeWidth={2}
          dot={{ r: 3, fill: colors.cyan }}
          activeDot={{ r: 5 }}
          name="WIP"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
