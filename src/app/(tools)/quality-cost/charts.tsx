"use client";

// Recharts lives here so the Cost of Quality page loads it only when a
// chart mounts. Import this module through next/dynamic.
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";
import type { CostCategory } from "@/lib/quality/cost";

/** Theme tokens per category: conformance in calm colours, failures in warm ones. */
const CATEGORY_COLOR: Record<CostCategory, string> = {
  prevention: chartTheme.colors.green,
  detection: chartTheme.colors.cyan,
  internalFailure: chartTheme.colors.amber,
  externalFailure: chartTheme.colors.red,
};

interface CostDistributionChartProps {
  data: { category: CostCategory; name: string; value: number }[];
  /** Formats a finite amount, "$" included. */
  formatAmount: (n: number) => string;
  /** Injected by ChartCard's ResponsiveContainer. */
  width?: number;
  height?: number;
}

export function CostDistributionChart({
  data,
  formatAmount,
  width,
  height,
}: CostDistributionChartProps) {
  return (
    <PieChart width={width} height={height}>
      <Pie
        data={data}
        dataKey="value"
        nameKey="name"
        cx="50%"
        cy="50%"
        outerRadius="75%"
        innerRadius="45%"
        paddingAngle={2}
      >
        {data.map((d) => (
          <Cell key={d.category} fill={CATEGORY_COLOR[d.category]} />
        ))}
      </Pie>
      <Tooltip
        contentStyle={chartTheme.tooltipStyle}
        formatter={(v) => {
          const n = typeof v === "number" ? v : Number(v);
          return Number.isFinite(n) ? formatAmount(n) : "—";
        }}
      />
      <Legend wrapperStyle={chartTheme.legendStyle} />
    </PieChart>
  );
}

/**
 * The failure share per quarter (whole percent; a quarter without one is a
 * gap), with the 30% mark the verdict warns above.
 */
export function FailureShareChart({
  data,
  highPct,
}: {
  data: { period: string; share: number | null }[];
  highPct: number;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 16, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} vertical={false} />
        <XAxis
          dataKey="period"
          tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          domain={[0, 100]}
          unit="%"
          tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip contentStyle={chartTheme.tooltipStyle} formatter={(v) => `${v}%`} />
        <ReferenceLine
          y={highPct}
          stroke={chartTheme.colors.red}
          strokeDasharray="2 4"
          strokeOpacity={0.6}
          label={{
            value: `${highPct}%`,
            fill: chartTheme.colors.red,
            fontSize: 11,
            position: "right",
          }}
        />
        <Line
          type="monotone"
          dataKey="share"
          name="Failure share"
          stroke={chartTheme.colors.amber}
          strokeWidth={2}
          dot={{ fill: chartTheme.colors.amber, r: 3 }}
          connectNulls={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
