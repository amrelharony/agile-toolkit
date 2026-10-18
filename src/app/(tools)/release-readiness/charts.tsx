"use client";

// Recharts lives here so the Release Readiness route loads it only when a
// chart mounts. release-readiness-client.tsx imports these via next/dynamic.
import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  ReferenceLine,
} from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";

export interface GatePassPoint {
  release: string;
  passRatePct: number;
}

interface GatePassControlChartProps {
  data: GatePassPoint[];
  control: { centerLinePct: number; uclPct: number; lclPct: number };
}

export function GatePassControlChart({ data, control }: GatePassControlChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
        <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="release"
          tick={{ fill: chartTheme.axisColor, fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
          height={50}
          angle={-45}
          textAnchor="end"
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
          formatter={(v) => [`${Number(v).toFixed(0)}%`, "Pass rate"]}
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
          dataKey="passRatePct"
          name="Pass rate"
          stroke={chartTheme.colors.cyan}
          strokeWidth={2}
          dot={{ fill: chartTheme.colors.cyan, r: 3 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function SkippedGatesChart({ data }: { data: { gate: string; skipped: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 60 }}>
        <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" />
        <XAxis
          dataKey="gate"
          tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
          angle={-30}
          textAnchor="end"
          interval={0}
          height={70}
        />
        <YAxis tick={{ fill: chartTheme.axisColor, fontSize: 11 }} allowDecimals={false} />
        <Tooltip contentStyle={chartTheme.tooltipStyle} />
        <Bar dataKey="skipped" fill={chartTheme.colors.amber} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
