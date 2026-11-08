"use client";

// Recharts lives here so the burndown page (and the Sprint cockpit's mini
// burndown, and Burnup's advanced section) load it only when a chart
// mounts. Import this module through next/dynamic, never statically.
import { useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  DefaultLegendContent,
  Legend,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  useChartWidth,
  usePlotArea,
  useXAxisScale,
  type DefaultLegendContentProps,
  type LegendPayload,
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
  scope,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number | number[]; color: string }>;
  label?: string | number;
  /** Scope labels kept off their lines (a narrow chart), by day: shown here instead. */
  scope?: ReadonlyMap<number, ScopeMark>;
}) {
  if (!active || !payload?.length) return null;
  const show = (v: number | number[] | null | undefined) =>
    v == null ? "—" : Array.isArray(v) ? `${v[0]}–${v[1]} pts` : `${v} pts`;
  const mark = scope?.get(Number(label));
  return (
    <div style={chartTheme.tooltipStyle} className="min-w-[140px] px-3 py-2">
      <p className="mb-1.5 font-semibold text-text">Day {label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-3 text-xs">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="font-data font-semibold text-text">{show(p.value)}</span>
        </div>
      ))}
      {mark && (
        <div className="flex items-center justify-between gap-3 text-xs">
          <span style={{ color: mark.color }}>Scope</span>
          <span className="font-data font-semibold text-text">
            {mark.label === SCOPE_FLAG ? "changed" : mark.label}
          </span>
        </div>
      )}
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

/** "Today" is the only label above the plot, so nothing else can print over it. */
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

/* -------------------------------------------------------------------------- */
/*  Scope markers                                                              */
/* -------------------------------------------------------------------------- */

/** A dashed line where scope joined (+) or left (−) the sprint, or a day the log flags. */
export interface ScopeMark {
  day: number;
  /** "+8", "−5", "+3 −2", or SCOPE_FLAG for a flagged day. */
  label: string;
  color: string;
}

/** The label of a day the log flags as a scope change (no amounts known). */
const SCOPE_FLAG = "Scope";

/** The scope markers for the moves (with amounts), or else the flagged days. */
export function scopeMarks(
  moves: readonly ScopeMove[] | undefined,
  flaggedDays: readonly number[]
): ScopeMark[] {
  const fmt = (n: number) => String(Math.round(n * 10) / 10);
  return moves?.length
    ? moves.map((m) => ({
        day: m.day,
        label: [m.added > 0 ? `+${fmt(m.added)}` : "", m.removed > 0 ? `−${fmt(m.removed)}` : ""]
          .filter(Boolean)
          .join(" "),
        color: m.added > 0 ? colors.amber : colors.purple,
      }))
    : flaggedDays.map((day) => ({ day, label: SCOPE_FLAG, color: colors.amber }));
}

/**
 * Below this many pixels between days (a 2-week sprint on a phone is about
 * 15), the scope amounts leave their lines for the tooltip and the legend:
 * "+8" on day 3, "−5" on day 4 and "Today" on day 5 printed as "+8−5Today".
 */
export const MIN_DAY_PX_FOR_SCOPE_LABELS = 25;

/** Where a scope label sits: its row under the plot's top edge, and which side of its line. */
export interface ScopeLabelSpot {
  row: number;
  side: "right" | "left";
}

// 12 px Inter: a digit or sign is about 6.7 px wide.
const LABEL_CHAR_PX = 7;
// Recharts' default label offset from the line.
const LABEL_OFFSET = 5;
const LABEL_GAP = 4;
const LABEL_ROW_PX = 14;

/**
 * Lays the scope labels out inside the plot's top edge, each beside its line
 * (to the right, or to the left where the right would run off the chart),
 * dropping a label to the next row when it would touch one already placed.
 * A label that fits in no row, or every label on a chart narrower than
 * MIN_DAY_PX_FOR_SCOPE_LABELS per day (with `hideWhenNarrow`), gets null:
 * its line stays, unlabelled. Pure, for tests.
 */
export function placeScopeLabels(
  marks: readonly { x: number; label: string }[],
  {
    dayPx,
    maxX,
    rows = 2,
    hideWhenNarrow = true,
  }: {
    /** Pixels between neighbouring days. */
    dayPx: number;
    /** The right edge labels may reach (the chart's width). */
    maxX: number;
    rows?: number;
    hideWhenNarrow?: boolean;
  }
): (ScopeLabelSpot | null)[] {
  const spots: (ScopeLabelSpot | null)[] = marks.map(() => null);
  if (hideWhenNarrow && !(dayPx >= MIN_DAY_PX_FOR_SCOPE_LABELS)) return spots;
  const taken: [number, number][][] = Array.from({ length: rows }, () => []);
  const order = marks.map((_, i) => i).sort((a, b) => marks[a].x - marks[b].x);
  for (const i of order) {
    const { x, label } = marks[i];
    const width = label.length * LABEL_CHAR_PX;
    const side = x + LABEL_OFFSET + width <= maxX ? "right" : "left";
    const span: [number, number] =
      side === "right"
        ? [x + LABEL_OFFSET, x + LABEL_OFFSET + width]
        : [x - LABEL_OFFSET - width, x - LABEL_OFFSET];
    const row = taken.findIndex((spans) =>
      spans.every(([a, b]) => span[1] + LABEL_GAP <= a || span[0] >= b + LABEL_GAP)
    );
    if (row === -1) continue;
    taken[row].push(span);
    spots[i] = { row, side };
  }
  return spots;
}

/**
 * Where the marks' labels go on this chart, from its x scale: null until the
 * chart is laid out (the lines draw bare for that first frame).
 */
function useScopeLabelSpots(
  marks: readonly ScopeMark[],
  {
    firstDays,
    rows,
    hideWhenNarrow,
  }: {
    /** The chart's first two days, to measure the spacing between days. */
    firstDays: readonly number[];
    rows: number;
    hideWhenNarrow: boolean;
  }
): (ScopeLabelSpot | null)[] | null {
  const xOf = useXAxisScale();
  const plot = usePlotArea();
  const chartWidth = useChartWidth();
  const [d0, d1] = firstDays;
  return useMemo(() => {
    if (!xOf || !plot || !chartWidth || marks.length === 0) return null;
    const at = (day: number) => xOf(day, { position: "middle" });
    const x0 = d0 === undefined ? undefined : at(d0);
    const x1 = d1 === undefined ? undefined : at(d1);
    // One day on the axis: nothing beside it to collide with.
    const dayPx = x0 !== undefined && x1 !== undefined ? Math.abs(x1 - x0) : Infinity;
    const placed = marks.map((m) => ({ x: at(m.day) ?? plot.x, label: m.label }));
    return placeScopeLabels(placed, { dayPx, maxX: chartWidth, rows, hideWhenNarrow });
  }, [xOf, plot, chartWidth, marks, d0, d1, rows, hideWhenNarrow]);
}

/** The dashed scope lines, each labelled where `spots` puts it (or bare). */
function scopeLines(marks: readonly ScopeMark[], spots: readonly (ScopeLabelSpot | null)[] | null) {
  return marks.map((m, i) => {
    const spot = spots?.[i] ?? null;
    return (
      <ReferenceLine
        key={`scope-${m.day}`}
        x={m.day}
        stroke={m.color}
        strokeDasharray="3 3"
        strokeWidth={1.5}
        label={
          spot
            ? {
                value: m.label,
                position: spot.side === "right" ? "insideTopLeft" : "insideTopRight",
                dy: spot.row * LABEL_ROW_PX,
                fill: m.color,
                fontSize: 12,
                // A halo in the card's colour keeps the label legible where
                // it crosses a line or the grid.
                stroke: "var(--card, #fffcf5)",
                strokeWidth: 3,
                paintOrder: "stroke",
              }
            : undefined
        }
      />
    );
  });
}

/** Burnup's scope markers: labels beside their lines, staggered, never moved off them. */
function StaggeredScopeMarkers({ marks }: { marks: readonly ScopeMark[] }) {
  const spots = useScopeLabelSpots(marks, { firstDays: [], rows: 3, hideWhenNarrow: false });
  return <>{scopeLines(marks, spots)}</>;
}

/**
 * Markers where scope joined (+) or left (−) the sprint, or a day the log
 * flags, labelled inside the plot so they never print over "Today" (Burnup).
 */
export function scopeMarkers(
  moves: readonly ScopeMove[] | undefined,
  flaggedDays: readonly number[]
) {
  return <StaggeredScopeMarkers marks={scopeMarks(moves, flaggedDays)} />;
}

/** A legend entry per kind of unlabelled scope line, so a bare dashed line still has a name. */
export function scopeLegendEntries(hidden: readonly ScopeMark[]): LegendPayload[] {
  const entries: LegendPayload[] = [];
  const add = (value: string, color: string) => {
    if (!entries.some((e) => e.value === value)) entries.push({ value, color, type: "line" });
  };
  for (const m of hidden) {
    if (m.label === SCOPE_FLAG) add("Scope change", m.color);
    else if (m.label.startsWith("+")) add("Scope added", m.color);
    else add("Scope removed", m.color);
  }
  return entries;
}

/**
 * The burndown's tooltip, legend, scope and today markers, laid out from the
 * plot's width: on a wide chart the scope amounts sit beside their lines; on
 * a narrow one (or where they'd collide) they move to the tooltip, and the
 * legend names the bare lines.
 */
function BurndownMarkers({
  marks,
  firstDays,
  todayDay,
}: {
  marks: readonly ScopeMark[];
  firstDays: readonly number[];
  todayDay: number | null;
}) {
  const spots = useScopeLabelSpots(marks, { firstDays, rows: 2, hideWhenNarrow: true });
  const hidden = useMemo(
    () => (spots ? marks.filter((_, i) => spots[i] === null) : []),
    [marks, spots]
  );
  const offLine = useMemo(() => new Map(hidden.map((m) => [m.day, m])), [hidden]);
  const extra = useMemo(() => scopeLegendEntries(hidden), [hidden]);
  const legendKey = extra.map((e) => e.value).join("|");
  // Stable between renders: Recharts renders `content` as a component.
  const legendContent = useMemo(
    () =>
      extra.length === 0
        ? undefined
        : function BurndownLegend(props: DefaultLegendContentProps) {
            return (
              <DefaultLegendContent {...props} payload={[...(props.payload ?? []), ...extra]} />
            );
          },
    [extra]
  );
  return (
    <>
      <Tooltip content={<PointsTooltip scope={offLine} />} />
      <Legend
        // Remounted when its entries change, so the chart re-measures its height.
        key={legendKey || "series"}
        wrapperStyle={chartTheme.legendStyle}
        iconType="line"
        content={legendContent}
      />
      {scopeLines(marks, spots)}
      {todayLine(todayDay, colors.magenta)}
    </>
  );
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
  const marks = useMemo(
    () => scopeMarks(scopeMoves, scopeChangeDays),
    [scopeMoves, scopeChangeDays]
  );
  const d0 = data[0]?.day;
  const d1 = data[1]?.day;
  const firstDays = useMemo(() => [d0, d1].filter((d): d is number => d !== undefined), [d0, d1]);
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
      <BurndownMarkers marks={marks} firstDays={firstDays} todayDay={todayDay} />
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
