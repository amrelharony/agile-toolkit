"use client";

// Recharts lives here so the LLM Eval Tracker page loads it only when the
// score chart mounts. Import this module through next/dynamic.
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";
import { CHART_COLORS, chartTheme } from "@/components/charts/chart-theme";

const COLORS = CHART_COLORS;

interface ScoreOverTimeChartProps {
  data: Record<string, string | number>[];
  series: { key: string; label: string }[];
}

export function ScoreOverTimeChart({ data, series }: ScoreOverTimeChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} />
        <XAxis dataKey="date" stroke={chartTheme.axisColor} fontSize={11} />
        <YAxis domain={[0, 1]} stroke={chartTheme.axisColor} fontSize={11} />
        <Tooltip contentStyle={chartTheme.tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <ReferenceLine y={0.8} stroke={chartTheme.colors.green} strokeDasharray="4 4" />
        {series.map((d, i) => (
          <Line
            key={d.key}
            dataKey={d.key}
            name={d.label}
            stroke={COLORS[i % COLORS.length]}
            strokeWidth={2}
            dot={{ r: 3 }}
            // R10: do NOT connectNulls. Most rows for a series
            // have `undefined` (only a single eval per date).
            // Bridging across undefined draws a smooth line
            // over weeks of no measurement, falsely implying
            // continuous data.
            connectNulls={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
