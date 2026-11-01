"use client";

// Recharts lives here so the Prioritizer loads it only when the Value vs.
// Effort scatter mounts. Import this module through next/dynamic.
import {
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";
import type { BucketTone } from "@/lib/prioritization/methods";
import { FIBONACCI_VALUES } from "@/lib/prioritization/methods/fibonacci";
import { VE_LABEL, VE_QUADRANTS } from "@/lib/prioritization/methods/value-effort";
import { quadrantTone } from "../constants";
import { EFFORT_SPLIT_AT, VALUE_SPLIT_AT, type MatrixPoint } from "../matrix";

const { colors } = chartTheme;

/*
 * Each quadrant wears its tone from the method registry, as theme
 * variables: Quick Wins green, Big Bets the accent, Fill-Ins muted, Time
 * Wasters red. The legend and the table name them too, so colour is never
 * the only cue.
 */
const TONE_FILL: Record<BucketTone, string> = {
  success: colors.green,
  accent: colors.cyan,
  warning: colors.amber,
  danger: colors.red,
  muted: chartTheme.axisColor,
};

function MatrixTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: MatrixPoint }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={chartTheme.tooltipStyle} className="min-w-[140px] px-3 py-2">
      <p className="mb-1 font-semibold text-text">{d.name}</p>
      <p className="text-xs text-sub">
        Value <span className="font-data text-text">{d.value}</span> · Effort{" "}
        <span className="font-data text-text">{d.effort}</span>
      </p>
      <p className="text-xs text-sub">{VE_LABEL[d.quadrant]}</p>
    </div>
  );
}

export function ValueEffortScatter({ points }: { points: MatrixPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      {/* ChartFigure gives the summary and table, so the SVG isn't a tab stop. */}
      <ScatterChart margin={{ top: 16, right: 16, bottom: 16, left: 0 }} accessibilityLayer={false}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} />
        <XAxis
          type="number"
          dataKey="effort"
          name="Effort"
          domain={[0.5, 10.5]}
          ticks={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]}
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          tickLine={false}
          label={{
            value: "Effort →",
            position: "insideBottomRight",
            offset: -8,
            fill: chartTheme.axisColor,
            fontSize: 12,
          }}
        />
        <YAxis
          type="number"
          dataKey="valueAt"
          name="Value"
          domain={[-0.5, FIBONACCI_VALUES.length - 0.5]}
          ticks={FIBONACCI_VALUES.map((_, i) => i)}
          tickFormatter={(i: number) => String(FIBONACCI_VALUES[i] ?? "")}
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          width={36}
        />
        <Tooltip content={<MatrixTooltip />} cursor={{ strokeDasharray: "3 3" }} />
        <Legend wrapperStyle={chartTheme.legendStyle} />
        {/* Quadrant lines: where high value (8) and high effort (6) begin. */}
        <ReferenceLine x={EFFORT_SPLIT_AT} stroke={chartTheme.axisColor} strokeOpacity={0.4} />
        <ReferenceLine y={VALUE_SPLIT_AT} stroke={chartTheme.axisColor} strokeOpacity={0.4} />
        {VE_QUADRANTS.map((q) => (
          <Scatter
            key={q}
            name={VE_LABEL[q]}
            data={points.filter((p) => p.quadrant === q)}
            fill={TONE_FILL[quadrantTone(q)]}
            fillOpacity={0.85}
          />
        ))}
      </ScatterChart>
    </ResponsiveContainer>
  );
}
