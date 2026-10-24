"use client";

// Recharts lives here so the page loads it only when the follow-through
// chart mounts. Import this module through next/dynamic.
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";
import type { FollowThroughPoint } from "./follow-through";

const { colors } = chartTheme;

/*
 * Done, carried over and dropped are states, so they wear the status
 * colours: green, amber, red. The legend and the table name them too, so
 * the colour is never the only cue.
 */
const SERIES = [
  { key: "done", name: "Done", fill: colors.green },
  { key: "carried", name: "Carried over", fill: colors.amber },
  { key: "open", name: "Still open", fill: colors.red },
] as const;

/**
 * Each past retro's actions, oldest first, stacked by what became of them:
 * the green share of a bar is that retro's follow-through, its height how
 * much the team took on.
 */
export function FollowThroughChart({ data }: { data: FollowThroughPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      {/* ChartFigure hides the plot behind its summary and table, so the SVG
          mustn't be a tab stop. */}
      <BarChart
        data={data}
        margin={{ top: 10, right: 12, left: -20, bottom: 0 }}
        accessibilityLayer={false}
      >
        <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="name"
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={chartTheme.tooltipStyle}
          labelFormatter={(label, payload) => {
            const rate = (payload?.[0]?.payload as FollowThroughPoint | undefined)?.rate;
            return rate ? `${label} · ${rate} done` : String(label);
          }}
        />
        <Legend wrapperStyle={chartTheme.legendStyle} />
        {SERIES.map((s) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.name}
            stackId="actions"
            fill={s.fill}
            // A thin gap in the surface colour keeps the stacked segments apart.
            stroke={chartTheme.cardBackground}
            strokeWidth={2}
            maxBarSize={48}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
