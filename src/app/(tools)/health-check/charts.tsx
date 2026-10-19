"use client";

// Recharts lives here so the health check loads it only when the trend
// chart mounts. Import this module through next/dynamic, never statically.
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  HEALTH_CHECK_DIMENSIONS as DIMENSIONS,
  type HealthDimension as Dimension,
} from "@/lib/stores/workspace-types";

const DIMENSION_COLORS: Record<Dimension, string> = {
  "Delivering Value": "#00f0ff",
  "Easy to Release": "#00ff88",
  Fun: "#ffaa00",
  "Health of Codebase": "#ff00aa",
  Learning: "#8b5cf6",
  Mission: "#f97316",
  Speed: "#06b6d4",
  Teamwork: "#84cc16",
};

const TOOLTIP_STYLE = {
  backgroundColor: "#1a1f36",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "8px",
  color: "#e2e8f0",
};

/** One row per past check: the sprint name plus a 0–2 score per dimension. */
export type HealthTrendRow = { name: string } & Record<string, string | number>;

export function HealthTrendChart({ data }: { data: HealthTrendRow[] }) {
  return (
    <ResponsiveContainer width="100%" height={360}>
      {/* ChartFigure hides the plot from assistive tech behind its summary and
          table, so the SVG mustn't be a tab stop. */}
      <LineChart
        data={data}
        margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
        accessibilityLayer={false}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis
          dataKey="name"
          tick={{ fill: "#94a3b8", fontSize: 12 }}
          axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
          tickLine={false}
        />
        <YAxis
          domain={[0, 2]}
          ticks={[0, 1, 2]}
          tickFormatter={(v) => (v === 2 ? "Green" : v === 1 ? "Yellow" : "Red")}
          tick={{ fill: "#94a3b8", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={56}
        />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend wrapperStyle={{ paddingTop: "16px", color: "#94a3b8", fontSize: 11 }} />
        {DIMENSIONS.map((dim) => (
          <Line
            key={dim}
            dataKey={dim}
            stroke={DIMENSION_COLORS[dim]}
            strokeWidth={2}
            dot={{ r: 3, fill: DIMENSION_COLORS[dim] }}
            activeDot={{ r: 5 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
