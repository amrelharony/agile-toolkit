"use client";

// Recharts lives here so the Sprint Metrics route loads it only when a
// chart mounts. Import this module through next/dynamic.
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";
import type { SayDoGrade } from "@/lib/sprints/metrics";
import type { ChurnPoint, SayDoPoint } from "./view";

const { colors } = chartTheme;

/*
 * Say/do grades wear the status colours: met green, close amber, missed
 * red, and over blue (saying less than the team could do isn't a win). The
 * table and the tooltip name the grade too, so colour is never the only cue.
 */
const GRADE_FILL: Record<SayDoGrade, string> = {
  met: colors.green,
  close: colors.amber,
  missed: colors.red,
  over: colors.blue,
};

const axis = {
  tick: { fill: chartTheme.axisColor, fontSize: 12 },
  tickLine: false,
} as const;

/** Say/do % by sprint, with the 90–110% "met" band behind the bars. */
export function SayDoChart({ data }: { data: SayDoPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      {/* ChartFigure hides the plot behind its summary and table. */}
      <BarChart
        data={data}
        margin={{ top: 10, right: 12, left: -16, bottom: 0 }}
        accessibilityLayer={false}
      >
        <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" vertical={false} />
        <ReferenceArea y1={90} y2={110} fill={colors.green} fillOpacity={0.08} />
        <ReferenceLine y={100} stroke={chartTheme.axisColor} strokeDasharray="4 4" />
        <XAxis
          dataKey="name"
          {...axis}
          axisLine={{ stroke: chartTheme.gridColor }}
          interval="preserveStartEnd"
        />
        <YAxis {...axis} axisLine={false} unit="%" allowDecimals={false} />
        <Tooltip
          contentStyle={chartTheme.tooltipStyle}
          cursor={{ fill: chartTheme.gridColor }}
          formatter={(value) => (value == null ? "No commitment" : `${value}%`)}
        />
        <Bar dataKey="pct" name="Say/do" radius={[4, 4, 0, 0]} maxBarSize={48}>
          {data.map((p, i) => (
            <Cell key={i} fill={p.grade ? GRADE_FILL[p.grade] : colors.cyan} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Carried-over points, and the scope that joined (up) or left (down) after day 0. */
export function ChurnChart({ data }: { data: ChurnPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart
        data={data}
        margin={{ top: 10, right: 12, left: -16, bottom: 0 }}
        stackOffset="sign"
        accessibilityLayer={false}
      >
        <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" vertical={false} />
        <ReferenceLine y={0} stroke={chartTheme.axisColor} />
        <XAxis
          dataKey="name"
          {...axis}
          axisLine={{ stroke: chartTheme.gridColor }}
          interval="preserveStartEnd"
        />
        <YAxis {...axis} axisLine={false} allowDecimals={false} />
        <Tooltip
          contentStyle={chartTheme.tooltipStyle}
          cursor={{ fill: chartTheme.gridColor }}
          formatter={(value) => (typeof value === "number" ? Math.abs(value) : value)}
        />
        <Legend wrapperStyle={{ paddingTop: "8px", ...chartTheme.legendStyle }} />
        <Bar dataKey="carried" name="Carried over" fill={colors.amber} maxBarSize={32} />
        <Bar
          dataKey="added"
          name="Scope added"
          stackId="scope"
          fill={colors.purple}
          maxBarSize={32}
        />
        <Bar
          dataKey="removed"
          name="Scope removed"
          stackId="scope"
          fill={colors.magenta}
          maxBarSize={32}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
