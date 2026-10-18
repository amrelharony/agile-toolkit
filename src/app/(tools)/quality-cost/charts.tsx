"use client";

// Recharts lives here so the Cost of Quality page loads it only when the
// distribution chart mounts. Import this module through next/dynamic.
import { PieChart, Pie, Cell, Tooltip, Legend } from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";

interface CostDistributionChartProps {
  data: { name: string; value: number; color: string }[];
  /** Formats a finite dollar amount (without the leading "$"). */
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
        outerRadius={110}
        innerRadius={60}
        paddingAngle={2}
        label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
      >
        {data.map((d) => (
          <Cell key={d.name} fill={d.color} />
        ))}
      </Pie>
      <Tooltip
        contentStyle={chartTheme.tooltipStyle}
        formatter={(v) => {
          const n = typeof v === "number" ? v : Number(v);
          return Number.isFinite(n) ? `$${formatAmount(n)}` : "—";
        }}
      />
      <Legend wrapperStyle={chartTheme.legendStyle} />
    </PieChart>
  );
}
