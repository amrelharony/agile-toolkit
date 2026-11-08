"use client";

// Recharts lives here so the Velocity route loads it only when a chart
// mounts. velocity-client.tsx imports this via next/dynamic.
import { useMemo, type ReactElement } from "react";
import {
  ComposedChart,
  Bar,
  Cell,
  DefaultLegendContent,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  usePlotArea,
  type DefaultLegendContentProps,
  type LegendPayload,
} from "recharts";
import { CausalLine, type CausalAnnotationData } from "@/components/charts/causal-annotation";
import { chartTheme } from "@/components/charts/chart-theme";
import type { SayDoGrade } from "@/lib/sprints/metrics";

const { colors } = chartTheme;

/**
 * The committed bar's fill: a tint of --chart-1 that clears 3:1 against the
 * night card (0.3 was about 1.9:1), with a full-colour outline that clears it
 * on paper and high contrast too (test/tools/velocity-chart-legend.test.tsx).
 */
export const COMMITTED_OPACITY = 0.55;

/*
 * A finished sprint's completed bar wears its say/do grade: met is green,
 * close amber, missed red and over (the team said less than it could do)
 * blue, so "over" doesn't read as a success. The table and the tooltip
 * name the grade too, so colour is never the only cue.
 */
export const GRADE_FILL: Record<SayDoGrade, string> = {
  met: colors.green,
  close: colors.amber,
  missed: colors.red,
  over: colors.blue,
};

export interface VelocityChartRow {
  name: string;
  committed: number;
  completed: number | null;
  /** The finished sprint's say/do grade and percentage. */
  grade?: SayDoGrade;
  sayDoPct?: number;
  rollingAvg?: number;
  trend?: number;
  forecast?: number;
  band80Lower?: number;
  band80Upper?: number;
  /** The synthetic "Next" row that carries only the forecast. */
  forecastOnly?: boolean;
}

interface VelocityChartProps {
  data: VelocityChartRow[];
  width?: number;
  height?: number;
}

const axis = {
  tick: { fill: chartTheme.axisColor, fontSize: 12 },
  tickLine: false,
} as const;

const isNum = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

/* -------------------------------------------------------------------------- */
/*  Legend                                                                     */
/* -------------------------------------------------------------------------- */

const GRADE_ORDER: readonly SayDoGrade[] = ["met", "close", "missed", "over"];
const GRADE_SHORT: Record<SayDoGrade, string> = {
  met: "met",
  close: "close",
  missed: "missed",
  over: "over",
};

/** The committed bar in little: the tint and its outline (the legend's 32-unit box). */
function CommittedSwatch() {
  return (
    <path
      d="M1.5,5.5h29v21h-29z"
      fill={colors.cyan}
      fillOpacity={COMMITTED_OPACITY}
      stroke={colors.cyan}
      strokeWidth={3}
      className="recharts-legend-icon"
    />
  );
}

/**
 * The legend entries for what the chart actually draws: Committed as its
 * tint, Completed in each say/do grade colour the bars wear (Recharts' own
 * legend showed two identical swatches that matched neither series), and
 * the rolling velocity and trend only when there is a line to name. Pure,
 * for tests.
 */
export function velocityLegendPayload(rows: readonly VelocityChartRow[]): LegendPayload[] {
  const entries: LegendPayload[] = [
    {
      value: "Committed",
      color: colors.cyan,
      // Recharts types the icon as an SVG element; it clones whatever is given.
      legendIcon: (<CommittedSwatch />) as unknown as ReactElement<SVGElement>,
    },
  ];
  const finished = rows.filter((r) => !r.forecastOnly && isNum(r.completed));
  for (const grade of GRADE_ORDER) {
    if (finished.some((r) => r.grade === grade)) {
      entries.push({
        value: `Completed (${GRADE_SHORT[grade]})`,
        type: "rect",
        color: GRADE_FILL[grade],
      });
    }
  }
  if (finished.some((r) => !r.grade)) {
    entries.push({ value: "Completed", type: "rect", color: colors.cyan });
  }
  if (rows.some((r) => isNum(r.rollingAvg))) {
    entries.push({ value: "Velocity (last 3)", type: "line", color: colors.magenta });
  }
  if (rows.some((r) => isNum(r.trend))) {
    entries.push({ value: "Trend", type: "line", color: colors.amber });
  }
  return entries;
}

/* -------------------------------------------------------------------------- */
/*  Sprint axis                                                                */
/* -------------------------------------------------------------------------- */

/** "Sprint 12" → "S12"; any other name is left as it is. */
export function shortSprintName(name: string): string {
  const m = /^sprint\s+(\d+)$/i.exec(name.trim());
  return m ? `S${m[1]}` : name;
}

// 12 px Inter: about 7 px a character (generous, so a "fit" really fits).
const TICK_CHAR_PX = 7;
const TICK_GAP = 8;

/**
 * How the sprint axis labels its bars in a plot this wide. Names that fit
 * under their bars stay as they are (Recharts' own spacing). Where they don't,
 * "Sprint N" shortens to "SN" and every bar keeps its label: Recharts used to
 * drop every other one ("Sprint 1, Sprint 3, Sprint 5" on a phone). Pure, for
 * tests.
 */
export function sprintAxisTicks(
  names: readonly string[],
  plotWidth: number | undefined
): { format?: (name: string) => string; interval?: 0 } {
  if (!plotWidth || names.length === 0) return {};
  const slot = plotWidth / names.length;
  const fits = (labels: readonly string[]) =>
    Math.max(...labels.map((l) => l.length)) * TICK_CHAR_PX + TICK_GAP <= slot;
  if (fits(names)) return {};
  const short = names.map(shortSprintName);
  // Still too many to label every bar: shortened, and Recharts thins them.
  return fits(short) ? { format: shortSprintName, interval: 0 } : { format: shortSprintName };
}

/** The sprint axis, labelled for the plot's width (it reads the chart's layout). */
function SprintAxis({ names }: { names: readonly string[] }) {
  const plot = usePlotArea();
  const { format, interval } = sprintAxisTicks(names, plot?.width);
  return (
    <XAxis
      dataKey="name"
      {...axis}
      axisLine={{ stroke: chartTheme.gridColor }}
      tickFormatter={format}
      interval={interval}
    />
  );
}

/* -------------------------------------------------------------------------- */
/*  The velocity chart                                                         */
/* -------------------------------------------------------------------------- */

/** Committed and completed by sprint, with the rolling velocity (and the trend once there's enough). */
export function VelocityChart({ data, width, height }: VelocityChartProps) {
  const legend = useMemo(() => velocityLegendPayload(data), [data]);
  // Stable between renders: Recharts renders `content` as a component.
  const legendContent = useMemo(
    () =>
      function VelocityLegend(props: DefaultLegendContentProps) {
        return <DefaultLegendContent {...props} payload={legend} />;
      },
    [legend]
  );
  const names = useMemo(() => data.map((r) => r.name), [data]);
  const hasRolling = data.some((r) => isNum(r.rollingAvg));
  const hasTrend = data.some((r) => isNum(r.trend));
  return (
    <ComposedChart
      width={width}
      height={height}
      data={data}
      margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
      // ChartCard hides the plot from assistive tech behind its summary and
      // table, so the SVG mustn't be a tab stop.
      accessibilityLayer={false}
    >
      <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} vertical={false} />
      <SprintAxis names={names} />
      <YAxis {...axis} axisLine={false} />
      <Tooltip contentStyle={chartTheme.tooltipStyle} cursor={{ fill: chartTheme.gridColor }} />
      <Legend
        // Remounted when its entries change, so the chart re-measures its height.
        key={legend.map((e) => e.value).join("|")}
        wrapperStyle={{ paddingTop: "16px", ...chartTheme.legendStyle }}
        content={legendContent}
      />
      <Bar
        dataKey="committed"
        name="Committed"
        fill={colors.cyan}
        fillOpacity={COMMITTED_OPACITY}
        stroke={colors.cyan}
        strokeWidth={1.5}
        radius={[4, 4, 0, 0]}
        maxBarSize={60}
      />
      <Bar
        dataKey="completed"
        name="Completed"
        fill={colors.cyan}
        radius={[4, 4, 0, 0]}
        maxBarSize={60}
      >
        {data.map((row, i) => (
          <Cell key={i} fill={row.grade ? GRADE_FILL[row.grade] : colors.cyan} />
        ))}
      </Bar>
      {hasRolling && (
        <Line
          dataKey="rollingAvg"
          name="Velocity (last 3)"
          stroke={colors.magenta}
          strokeWidth={2}
          dot={false}
          connectNulls
        />
      )}
      {/* Drawn only once there's a trend, so the legend never names an empty line. */}
      {hasTrend && (
        <Line
          dataKey="trend"
          name="Trend"
          stroke={colors.amber}
          strokeWidth={1.5}
          strokeDasharray="4 4"
          dot={false}
        />
      )}
    </ComposedChart>
  );
}

interface ForecastChartProps {
  data: VelocityChartRow[];
  /** CUSUM regime-shift markers, keyed for React. */
  markers: { key: string; annotation: CausalAnnotationData }[];
}

/**
 * Completed points with the Bayesian forecast band and change points, for
 * Advanced analysis. Sizes itself: it sits in a ChartFigure, not a ChartCard.
 */
export function ForecastChart({ data, markers }: ForecastChartProps) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ForecastPlot data={data} markers={markers} />
    </ResponsiveContainer>
  );
}

function ForecastPlot({
  data,
  markers,
  width,
  height,
}: ForecastChartProps & { width?: number; height?: number }) {
  return (
    <ComposedChart
      width={width}
      height={height}
      data={data}
      margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
      // ChartFigure hides the plot behind its summary and table.
      accessibilityLayer={false}
    >
      <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} vertical={false} />
      <XAxis dataKey="name" {...axis} axisLine={{ stroke: chartTheme.gridColor }} />
      <YAxis {...axis} axisLine={false} />
      <Tooltip contentStyle={chartTheme.tooltipStyle} />
      <Legend wrapperStyle={{ paddingTop: "16px", ...chartTheme.legendStyle }} />
      {/* The 80% band, drawn behind the lines. The lower-mask Area paints
          the background over the upper one, so only the band shows. */}
      <Area
        dataKey="band80Upper"
        name="80% forecast"
        stroke="none"
        fill={colors.cyan}
        fillOpacity={0.18}
        connectNulls
        isAnimationActive={false}
      />
      <Area
        dataKey="band80Lower"
        stroke="none"
        fill={chartTheme.background}
        fillOpacity={1}
        legendType="none"
        connectNulls
        isAnimationActive={false}
      />
      <Line
        dataKey="completed"
        name="Completed"
        stroke={colors.cyan}
        strokeWidth={2}
        connectNulls
      />
      <Line
        dataKey="forecast"
        name="Forecast"
        stroke={colors.cyan}
        strokeWidth={2}
        strokeDasharray="5 5"
        dot={false}
        connectNulls
      />
      {/* CUSUM regime-shift markers anchored to the sprint's name. */}
      {markers.map((m) => (
        <CausalLine key={m.key} annotation={m.annotation} />
      ))}
    </ComposedChart>
  );
}
