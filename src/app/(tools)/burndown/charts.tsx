"use client";

// Recharts lives here so the burndown page (and the Sprint cockpit's mini
// burndown, and Burnup's advanced section) load it only when a chart
// mounts. Import this module through next/dynamic, never statically.
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";

const { colors } = chartTheme;

export interface BurndownChartRow {
  day: number;
  ideal: number;
  actual: number | null;
  /** Holt's forecast (the advanced section's chart; the main chart doesn't draw it). */
  forecast?: number;
  band80Lower?: number;
  band80Upper?: number;
}

/** A run of days off on the x-axis: from a day's tick to the tick after the last one. */
export interface OffDaySpan {
  from: number;
  to: number;
}

/** Scope that joined or left the sprint on a day. */
export interface ScopeMove {
  day: number;
  added: number;
  removed: number;
}

/* -------------------------------------------------------------------------- */
/*  Pieces both charts share                                                   */
/* -------------------------------------------------------------------------- */

function PointsTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number | number[]; color: string }>;
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  const show = (v: number | number[] | null | undefined) =>
    v == null ? "—" : Array.isArray(v) ? `${v[0]}–${v[1]} pts` : `${v} pts`;
  return (
    <div style={chartTheme.tooltipStyle} className="min-w-[140px] px-3 py-2">
      <p className="mb-1.5 font-semibold text-text">Day {label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-3 text-xs">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="font-data font-semibold text-text">{show(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Weekends and holidays, shaded: the ideal line counts working days, so it
 * is flat across them. The table and the rows name them too, so the shade
 * is never the only cue.
 */
function offDayAreas(spans: readonly OffDaySpan[] | undefined) {
  return (spans ?? []).map((s) => (
    <ReferenceArea
      key={`off-${s.from}`}
      x1={s.from}
      x2={s.to}
      fill={chartTheme.axisColor}
      fillOpacity={0.12}
      stroke="none"
      ifOverflow="hidden"
    />
  ));
}

function dayAxis(label = "Sprint day") {
  return (
    <XAxis
      dataKey="day"
      tickFormatter={(v: number) => `D${v}`}
      tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
      axisLine={{ stroke: chartTheme.gridColor }}
      tickLine={false}
      label={{
        value: label,
        position: "insideBottomRight",
        offset: -10,
        fill: chartTheme.axisColor,
        fontSize: 12,
      }}
    />
  );
}

function pointsAxis() {
  return (
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
  );
}

function todayLine(todayDay: number | null, color: string) {
  return todayDay === null ? null : (
    <ReferenceLine
      x={todayDay}
      stroke={color}
      strokeWidth={2}
      strokeDasharray="5 3"
      label={{ value: "Today", position: "top", fill: color, fontSize: 12, fontWeight: 600 }}
    />
  );
}

/** Markers where scope joined (+) or left (−) the sprint, or a day the log flags. */
export function scopeMarkers(
  moves: readonly ScopeMove[] | undefined,
  flaggedDays: readonly number[]
) {
  const fmt = (n: number) => String(Math.round(n * 10) / 10);
  const marks = moves?.length
    ? moves.map((m) => ({
        day: m.day,
        label: [m.added > 0 ? `+${fmt(m.added)}` : "", m.removed > 0 ? `−${fmt(m.removed)}` : ""]
          .filter(Boolean)
          .join(" "),
        color: m.added > 0 ? colors.amber : colors.purple,
      }))
    : flaggedDays.map((day) => ({ day, label: "Scope", color: colors.amber }));
  return marks.map((m) => (
    <ReferenceLine
      key={`scope-${m.day}`}
      x={m.day}
      stroke={m.color}
      strokeDasharray="3 3"
      strokeWidth={1.5}
      label={{ value: m.label, position: "top", fill: m.color, fontSize: 12 }}
    />
  ));
}

/* -------------------------------------------------------------------------- */
/*  The burndown                                                               */
/* -------------------------------------------------------------------------- */

interface BurndownChartProps {
  data: BurndownChartRow[];
  /** Days the log flags as a scope change (markers when `scopeMoves` isn't given). */
  scopeChangeDays: number[];
  todayDay: number | null;
  /**
   * Kept for callers from before the change points moved to the advanced
   * section; the main chart no longer draws them.
   */
  changepointDays?: Array<{ day: number; direction: "up" | "down" }>;
  /** Days off, shaded. */
  offDays?: OffDaySpan[];
  /** Scope that joined or left by day, marked with how much. */
  scopeMoves?: ScopeMove[];
  /** Injected by ChartCard's ResponsiveContainer. */
  width?: number;
  height?: number;
}

export function BurndownChart({
  data,
  scopeChangeDays,
  todayDay,
  offDays,
  scopeMoves,
  width,
  height,
}: BurndownChartProps) {
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
      {offDayAreas(offDays)}
      {dayAxis()}
      {pointsAxis()}
      <Tooltip content={<PointsTooltip />} />
      <Legend wrapperStyle={chartTheme.legendStyle} iconType="line" />
      {scopeMarkers(scopeMoves, scopeChangeDays)}
      {todayLine(todayDay, colors.magenta)}
      <Line
        type="linear"
        dataKey="ideal"
        name="Ideal"
        stroke={chartTheme.axisColor}
        strokeWidth={2}
        strokeDasharray="6 4"
        dot={false}
        activeDot={false}
        connectNulls
        isAnimationActive={false}
      />
      <Line
        type="linear"
        dataKey="actual"
        name="Actual"
        stroke={colors.cyan}
        strokeWidth={2.5}
        dot={{ fill: colors.cyan, r: 3, strokeWidth: 0 }}
        activeDot={{ r: 5, fill: colors.cyan, strokeWidth: 0 }}
        connectNulls={false}
        isAnimationActive={false}
      />
    </ComposedChart>
  );
}

/* -------------------------------------------------------------------------- */
/*  The advanced section's forecast                                            */
/* -------------------------------------------------------------------------- */

export interface ForecastChartRow {
  day: number;
  /** The working-day sample the forecast was fitted on. */
  actual: number | null;
  forecast: number | null;
  /** The 80% range, low and high. */
  band: [number, number] | null;
}

interface ForecastChartProps {
  data: ForecastChartRow[];
  /** "Points left" or "Points done". */
  name: string;
  /** Where CUSUM saw the pace shift. */
  shifts: Array<{ day: number; direction: "up" | "down" }>;
  offDays?: OffDaySpan[];
  todayDay: number | null;
  height?: number;
}

/**
 * Holt's forecast from the working-day samples, with its 80% range as a
 * band, and the days CUSUM saw the pace shift. Shown only in the advanced
 * section, once there are enough working days for it. It sizes itself
 * (ChartFigure has no container of its own).
 */
export function ForecastChart({
  data,
  name,
  shifts,
  offDays,
  todayDay,
  height = 240,
}: ForecastChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      {/* ChartFigure hides the plot behind its summary and table, so the SVG
          mustn't be a tab stop. */}
      <ComposedChart
        data={data}
        margin={{ top: 16, right: 20, left: 0, bottom: 0 }}
        accessibilityLayer={false}
      >
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} vertical={false} />
        {offDayAreas(offDays)}
        {dayAxis()}
        {pointsAxis()}
        <Tooltip content={<PointsTooltip />} />
        <Legend wrapperStyle={chartTheme.legendStyle} iconType="line" />
        {todayLine(todayDay, colors.magenta)}
        {shifts.map((s) => (
          <ReferenceLine
            key={`shift-${s.day}-${s.direction}`}
            x={s.day}
            stroke={colors.purple}
            strokeDasharray="3 3"
            label={{
              value: s.direction === "up" ? "Shift up" : "Shift down",
              position: "top",
              fill: colors.purple,
              fontSize: 12,
            }}
          />
        ))}
        <Area
          dataKey="band"
          name="80% range"
          stroke="none"
          fill={colors.cyan}
          fillOpacity={0.18}
          connectNulls
          isAnimationActive={false}
        />
        <Line
          type="linear"
          dataKey="actual"
          name={name}
          stroke={colors.cyan}
          strokeWidth={2.5}
          dot={{ fill: colors.cyan, r: 3, strokeWidth: 0 }}
          connectNulls
          isAnimationActive={false}
        />
        <Line
          type="linear"
          dataKey="forecast"
          name="Forecast"
          stroke={colors.cyan}
          strokeWidth={2}
          strokeDasharray="5 5"
          dot={false}
          connectNulls
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
