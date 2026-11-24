"use client";

// Recharts lives here so the page loads it only when the run chart mounts.
// Import this module through next/dynamic.
import {
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

export interface ReadingPoint {
  /** The day, YYYY-MM-DD. */
  date: string;
  value: number;
}

/**
 * The readings over time as a run chart, with the target as a dashed line
 * (and where things stood when it started as a dotted one). The summary and
 * the table beside it say the same in words.
 */
export function ReadingsChart({
  data,
  target,
  start,
  unit,
}: {
  data: ReadingPoint[];
  target?: number;
  start?: number;
  unit?: string;
}) {
  // A target at the bottom (the usual aim when less is better) sat on the
  // axis, its label over the last date: leave a band of room under the
  // lowest of the readings, the target and the start.
  const values = [
    ...data.map((d) => d.value),
    ...(target !== undefined ? [target] : []),
    ...(start !== undefined ? [start] : []),
  ].filter((v) => Number.isFinite(v));
  const low = values.length > 0 ? Math.min(...values) : 0;
  const high = values.length > 0 ? Math.max(...values) : 0;
  const pad = Math.max((high - low) * 0.15, Math.abs(low) * 0.05, 1);
  // Never below zero for readings that can't go there.
  const floor = low >= 0 ? Math.max(0, Math.floor(low - pad)) : Math.floor(low - pad);
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart
        data={data}
        margin={{ top: 12, right: 8, left: -16, bottom: 0 }}
        accessibilityLayer={false}
      >
        <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          tickLine={false}
          tickFormatter={(d: string) => d.slice(5)}
          minTickGap={16}
        />
        <YAxis
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          width={44}
          domain={[floor, "auto"]}
        />
        <Tooltip
          contentStyle={chartTheme.tooltipStyle}
          formatter={(value) => [unit ? `${value} ${unit}` : String(value), "Reading"]}
        />
        {target !== undefined && (
          <ReferenceLine
            y={target}
            stroke={chartTheme.colors.green}
            strokeDasharray="6 4"
            strokeWidth={2}
            ifOverflow="extendDomain"
            label={{
              value: "Target",
              fill: chartTheme.colors.green,
              fontSize: 12,
              position: "insideTopRight",
            }}
          />
        )}
        {start !== undefined && start !== target && (
          <ReferenceLine
            y={start}
            stroke={chartTheme.axisColor}
            strokeDasharray="2 4"
            ifOverflow="extendDomain"
          />
        )}
        <Line
          type="linear"
          dataKey="value"
          name="Reading"
          stroke={chartTheme.colors.cyan}
          strokeWidth={2}
          dot={{ r: 3 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
