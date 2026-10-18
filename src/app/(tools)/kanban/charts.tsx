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
  limits: ControlLimits | null;
  annotations: CausalAnnotationData[];
}

export function WeeklyThroughputChart({ data, limits, annotations }: WeeklyThroughputChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis
          dataKey="label"
          tick={{ fill: "var(--sub)", fontSize: 11 }}
          axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: "var(--sub)", fontSize: 11 }}
          axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
          tickLine={false}
          allowDecimals={false}
        />
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
                fontSize: 10,
                position: "right",
              }}
            />
            <ReferenceLine
              y={limits.ucl}
              stroke="var(--destructive)"
              strokeDasharray="4 2"
              label={{
                value: `UCL ${limits.ucl.toFixed(1)}`,
                fill: "var(--destructive)",
                fontSize: 10,
                position: "right",
              }}
            />
            <ReferenceLine
              y={limits.lcl}
              stroke="var(--destructive)"
              strokeDasharray="4 2"
              label={{
                value: `LCL ${limits.lcl.toFixed(1)}`,
                fill: "var(--destructive)",
                fontSize: 10,
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
          name="Completed"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
