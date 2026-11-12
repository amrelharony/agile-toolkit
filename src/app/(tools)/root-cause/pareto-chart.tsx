"use client";

// Recharts lives here so the page loads it only when the Pareto chart
// mounts. Import this module through next/dynamic.
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";

export interface ParetoPoint {
  /** A short label for the axis. */
  name: string;
  /** The cause in full, for the tooltip. */
  cause: string;
  count: number;
  /** Running share, 0–100. */
  cumulative: number;
  vital: boolean;
}

const { colors } = chartTheme;

/**
 * Causes as bars, most first, with the running share as a line on its own
 * 0–100% axis. The vital few wear the main colour, the rest a quieter one;
 * the summary and the table say which is which, so colour is never the only
 * cue.
 */
export function ParetoChart({ data }: { data: ParetoPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart
        data={data}
        margin={{ top: 10, right: 4, left: -20, bottom: 0 }}
        accessibilityLayer={false}
      >
        <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="name"
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          tickLine={false}
          interval={0}
        />
        <YAxis
          yAxisId="count"
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
        />
        <YAxis
          yAxisId="share"
          orientation="right"
          domain={[0, 100]}
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `${v}%`}
          width={44}
        />
        <Tooltip
          contentStyle={chartTheme.tooltipStyle}
          labelFormatter={(_label, payload) =>
            (payload?.[0]?.payload as ParetoPoint | undefined)?.cause ?? ""
          }
          formatter={(value, name) =>
            name === "Running share" ? [`${value}%`, name] : [String(value), name]
          }
        />
        <Bar yAxisId="count" dataKey="count" name="How often" maxBarSize={44}>
          {data.map((p) => (
            <Cell
              key={p.name}
              fill={p.vital ? colors.cyan : colors.purple}
              fillOpacity={p.vital ? 1 : 0.55}
            />
          ))}
        </Bar>
        <Line
          yAxisId="share"
          type="monotone"
          dataKey="cumulative"
          name="Running share"
          stroke={colors.amber}
          strokeWidth={2}
          dot={{ r: 3 }}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
