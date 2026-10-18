"use client";

// Recharts lives here so the OKRs page loads it only when a KR-progress
// chart mounts. Import this module through next/dynamic.
import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ReferenceLine } from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";
import { CausalLine, type CausalAnnotationData } from "@/components/charts/causal-annotation";

interface KrProgressChartProps {
  data: { kr: string; progressPct: number }[];
  annotations: CausalAnnotationData[];
  /** Injected by ChartCard's ResponsiveContainer. */
  width?: number;
  height?: number;
}

export function KrProgressChart({ data, annotations, width, height }: KrProgressChartProps) {
  return (
    <LineChart
      width={width}
      height={height}
      data={data}
      margin={{ top: 8, right: 12, left: -16, bottom: 4 }}
    >
      <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" />
      <XAxis dataKey="kr" tick={{ fill: chartTheme.axisColor, fontSize: 10 }} interval={0} />
      <YAxis domain={[0, 100]} tick={{ fill: chartTheme.axisColor, fontSize: 10 }} />
      <Tooltip contentStyle={chartTheme.tooltipStyle} />
      <Line
        type="monotone"
        dataKey="progressPct"
        name="Progress %"
        stroke={chartTheme.colors.cyan}
        strokeWidth={2}
        dot={{ r: 3 }}
      />
      <ReferenceLine
        y={70}
        stroke={chartTheme.colors.amber}
        strokeDasharray="2 4"
        strokeOpacity={0.55}
        label={{
          value: "Target band",
          fill: chartTheme.colors.amber,
          fontSize: 10,
          position: "right",
        }}
      />
      {annotations.map((ann, i) => (
        <CausalLine key={`okr-cusum-${i}`} annotation={ann} />
      ))}
    </LineChart>
  );
}
