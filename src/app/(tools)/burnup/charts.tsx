"use client";

// Recharts lives here so the burnup page loads it only when the chart
// mounts. Import this module through next/dynamic, never statically.
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";
import { scopeMarkers, type OffDaySpan, type ScopeMove } from "../burndown/charts";

const { colors } = chartTheme;

export interface BurnupChartRow {
  day: number;
  scope: number | null;
  completed: number | null;
  /** Holt's forecast (the advanced section's chart; the main chart doesn't draw it). */
  forecast?: number;
  band80Lower?: number;
  band80Upper?: number;
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string; fill?: string }>;
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div style={chartTheme.tooltipStyle} className="min-w-[150px] px-3 py-2">
      <p className="mb-1.5 font-semibold text-text">Day {label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-3 text-xs">
          <span style={{ color: p.color || p.fill }}>{p.name}</span>
          <span className="font-data font-semibold text-text">
            {p.value != null ? `${p.value} pts` : "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

interface BurnupChartProps {
  data: BurnupChartRow[];
  todayDay: number | null;
  /** Kept for callers from before the change points moved to the advanced section; ignored. */
  changepointDays?: Array<{ day: number; direction: "up" | "down" }>;
  /** Days off, shaded. */
  offDays?: OffDaySpan[];
  /** Scope that joined (+) or left (−) by day, marked with how much. */
  scopeMoves?: ScopeMove[];
  /** Injected by ChartCard's ResponsiveContainer. */
  width?: number;
  height?: number;
}

/**
 * Points done climbing towards the scope line. The scope steps up where
 * work joined the sprint and down where it left, each marked with how much;
 * the today marker wears a colour of its own so it never reads as scope.
 */
export function BurnupChart({
  data,
  todayDay,
  offDays,
  scopeMoves,
  width,
  height,
}: BurnupChartProps) {
  return (
    <ComposedChart
      width={width}
      height={height}
      data={data}
      margin={{ top: 16, right: 20, left: 0, bottom: 0 }}
      // ChartCard hides the plot from assistive tech behind its summary and
      // table, so the SVG mustn't be a tab stop.
      accessibilityLayer={false}
    >
      <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} vertical={false} />
      {(offDays ?? []).map((s) => (
        <ReferenceArea
          key={`off-${s.from}`}
          x1={s.from}
          x2={s.to}
          fill={chartTheme.axisColor}
          fillOpacity={0.12}
          stroke="none"
          ifOverflow="hidden"
        />
      ))}
      <XAxis
        dataKey="day"
        tickFormatter={(v: number) => `D${v}`}
        tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
        axisLine={{ stroke: chartTheme.gridColor }}
        tickLine={false}
        label={{
          value: "Sprint day",
          position: "insideBottomRight",
          offset: -10,
          fill: chartTheme.axisColor,
          fontSize: 12,
        }}
      />
      <YAxis
        tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
        axisLine={false}
        tickLine={false}
        label={{
          value: "Points",
          angle: -90,
          position: "insideLeft",
          fill: chartTheme.axisColor,
          fontSize: 12,
          offset: 10,
        }}
        domain={[0, "auto"]}
      />
      <Tooltip content={<CustomTooltip />} />
      <Legend wrapperStyle={chartTheme.legendStyle} iconType="line" />

      {scopeMarkers(scopeMoves, [])}

      {todayDay !== null && (
        <ReferenceLine
          x={todayDay}
          stroke={colors.blue}
          strokeWidth={2}
          strokeDasharray="5 3"
          label={{
            value: "Today",
            position: "top",
            fill: colors.blue,
            fontSize: 12,
            fontWeight: 600,
          }}
        />
      )}

      <Area
        type="linear"
        dataKey="completed"
        name="Done"
        fill={colors.cyan}
        fillOpacity={0.15}
        stroke={colors.cyan}
        strokeWidth={2.5}
        dot={{ fill: colors.cyan, r: 3, strokeWidth: 0 }}
        activeDot={{ r: 5, fill: colors.cyan, strokeWidth: 0 }}
        connectNulls={false}
        isAnimationActive={false}
      />
      <Line
        type="stepAfter"
        dataKey="scope"
        name="Scope"
        stroke={colors.magenta}
        strokeWidth={2}
        strokeDasharray="4 4"
        dot={false}
        activeDot={{ r: 5, fill: colors.magenta, strokeWidth: 0 }}
        connectNulls
        isAnimationActive={false}
      />
    </ComposedChart>
  );
}
