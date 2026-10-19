"use client";

// Recharts lives here so the DoD builder loads it only when the adherence
// chart mounts. Import this module through next/dynamic, never statically.
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
import { chartTheme } from "@/components/charts/chart-theme";

export function DodAdherenceChart({
  data,
  control,
}: {
  data: Array<{ sprintName: string; adherencePct: number }>;
  control: { centerLinePct: number; uclPct: number; lclPct: number };
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
        <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="sprintName"
          tick={{ fill: chartTheme.axisColor, fontSize: 10 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fill: chartTheme.axisColor, fontSize: 10 }}
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
          strokeOpacity={0.55}
          label={{
            value: "X̄",
            fill: chartTheme.colors.cyan,
            fontSize: 10,
            position: "right",
          }}
          ifOverflow="extendDomain"
        />
        <ReferenceLine
          y={control.uclPct}
          stroke={chartTheme.colors.green}
          strokeDasharray="2 4"
          strokeOpacity={0.55}
          label={{
            value: "UCL",
            fill: chartTheme.colors.green,
            fontSize: 10,
            position: "right",
          }}
          ifOverflow="extendDomain"
        />
        <ReferenceLine
          y={control.lclPct}
          stroke={chartTheme.colors.red}
          strokeDasharray="2 4"
          strokeOpacity={0.55}
          label={{
            value: "LCL",
            fill: chartTheme.colors.red,
            fontSize: 10,
            position: "right",
          }}
          ifOverflow="extendDomain"
        />
        <Line
          type="monotone"
          dataKey="adherencePct"
          name="Adherence"
          stroke={chartTheme.colors.cyan}
          strokeWidth={2}
          dot={{ fill: chartTheme.colors.cyan, r: 3 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
