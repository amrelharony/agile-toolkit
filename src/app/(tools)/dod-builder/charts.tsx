"use client";

// Recharts lives here so the DoD builder loads it only when a chart
// mounts. Import this module through next/dynamic, never statically.
import {
  Bar,
  BarChart,
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
import type { AdherenceControl, AdherencePoint } from "./adherence";

const axis = { fill: chartTheme.axisColor, fontSize: 12 };

/** Each sprint's done stories meeting the DoD, as a %, oldest first. */
export function DodAdherenceChart({ data }: { data: AdherencePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      {/* ChartFigure hides the plot behind its summary and table, so the SVG
          mustn't be a tab stop. */}
      <BarChart
        data={data}
        margin={{ top: 8, right: 12, left: -12, bottom: 0 }}
        accessibilityLayer={false}
      >
        <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="name" tick={axis} axisLine={false} tickLine={false} />
        <YAxis
          domain={[0, 100]}
          tick={axis}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `${v}%`}
        />
        <Tooltip
          contentStyle={chartTheme.tooltipStyle}
          formatter={(v, _n, item) => {
            const p = (item as { payload?: AdherencePoint } | undefined)?.payload;
            return [p ? `${v}% (${p.meeting} of ${p.done})` : `${v}%`, "Meeting the DoD"];
          }}
        />
        <Bar dataKey="pct" name="Meeting the DoD" fill={chartTheme.colors.cyan} maxBarSize={48} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** The same series with p-chart limits, for Advanced analysis. */
export function DodControlChart({
  data,
  control,
}: {
  data: AdherencePoint[];
  control: AdherenceControl;
}) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart
        data={data}
        margin={{ top: 8, right: 12, left: -12, bottom: 0 }}
        accessibilityLayer={false}
      >
        <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="name" tick={axis} axisLine={false} tickLine={false} />
        <YAxis
          domain={[0, 100]}
          tick={axis}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `${v}%`}
        />
        <Tooltip
          contentStyle={chartTheme.tooltipStyle}
          formatter={(v) => [`${Number(v).toFixed(0)}%`, "Adherence"]}
        />
        <ReferenceLine
          y={control.centerLinePct}
          stroke={chartTheme.colors.cyan}
          strokeDasharray="2 4"
          ifOverflow="extendDomain"
        />
        <ReferenceLine
          y={control.uclPct}
          stroke={chartTheme.colors.green}
          strokeDasharray="2 4"
          ifOverflow="extendDomain"
        />
        <ReferenceLine
          y={control.lclPct}
          stroke={chartTheme.colors.red}
          strokeDasharray="2 4"
          ifOverflow="extendDomain"
        />
        <Line
          type="monotone"
          dataKey="pct"
          name="Adherence"
          stroke={chartTheme.colors.cyan}
          strokeWidth={2}
          dot={{ fill: chartTheme.colors.cyan, r: 3 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
