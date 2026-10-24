"use client";

// Recharts lives here so the Kanban page loads it only when the throughput
// chart mounts. Import this module through next/dynamic.
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { CausalLine, type CausalAnnotationData } from "@/components/charts/causal-annotation";
import type { ControlLimits } from "@/lib/analytics/control-chart";

interface WeeklyThroughputChartProps {
  data: Array<{ label: string; value: number }>;
  /** XmR limits, drawn on the control-chart view only. */
  limits?: ControlLimits | null;
  /** CUSUM change points, drawn on the control-chart view only. */
  annotations?: CausalAnnotationData[];
}

const AXIS = { stroke: "var(--border)" };
const TICK = { fill: "var(--sub)", fontSize: 12 };

export function WeeklyThroughputChart({
  data,
  limits = null,
  annotations = [],
}: WeeklyThroughputChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      {/* ChartFigure hides the plot from assistive tech behind its summary
          and table, so the SVG mustn't be a tab stop. */}
      <LineChart
        data={data}
        margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
        accessibilityLayer={false}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey="label" tick={TICK} axisLine={AXIS} tickLine={false} />
        <YAxis tick={TICK} axisLine={AXIS} tickLine={false} allowDecimals={false} />
        <Tooltip
          contentStyle={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontSize: 12,
          }}
          labelStyle={{ color: "var(--sub)" }}
        />
        {limits && (
          <>
            <ReferenceLine
              y={limits.centerLine}
              stroke="var(--sub)"
              strokeDasharray="2 4"
              label={{
                value: `X̄ ${limits.centerLine.toFixed(1)}`,
                fill: "var(--sub)",
                fontSize: 12,
                position: "right",
              }}
            />
            <ReferenceLine
              y={limits.ucl}
              stroke="var(--danger)"
              strokeDasharray="4 2"
              label={{
                value: `UCL ${limits.ucl.toFixed(1)}`,
                fill: "var(--danger)",
                fontSize: 12,
                position: "right",
              }}
            />
            <ReferenceLine
              y={limits.lcl}
              stroke="var(--danger)"
              strokeDasharray="4 2"
              label={{
                value: `LCL ${limits.lcl.toFixed(1)}`,
                fill: "var(--danger)",
                fontSize: 12,
                position: "right",
              }}
            />
          </>
        )}
        {annotations.map((a, i) => (
          <CausalLine key={i} annotation={a} />
        ))}
        <Line
          type="monotone"
          dataKey="value"
          stroke="var(--accent)"
          strokeWidth={2}
          dot={{ r: 3, fill: "var(--accent)" }}
          activeDot={{ r: 5 }}
          name="Finished"
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
