"use client";

// Recharts lives here so the Release Planner route loads it only when the
// chart mounts. forecast-view.tsx imports these via next/dynamic.
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";

/* -------------------------------------------------------------------------- */
/*  Tooltip                                                                    */
/* -------------------------------------------------------------------------- */

function HistogramTooltip({
  active,
  payload,
  label,
  total,
}: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: number;
  total: number;
}) {
  if (!active || !payload?.length) return null;
  const count = payload[0].value;
  const pct = total > 0 ? ((count / total) * 100).toFixed(1) : "0";
  return (
    <div style={chartTheme.tooltipStyle} className="px-3 py-2 min-w-[140px]">
      <p className="mb-1 font-semibold text-text">
        {label} Sprint{label !== 1 ? "s" : ""}
      </p>
      <div className="text-xs space-y-0.5">
        <div className="flex justify-between gap-3">
          <span className="text-sub">Runs</span>
          <span className="font-data text-accent">{count.toLocaleString()}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-sub">Share of runs</span>
          <span className="font-data text-accent">{pct}%</span>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Histogram                                                                  */
/* -------------------------------------------------------------------------- */

interface SimulationHistogramChartProps {
  histogram: { sprints: number; count: number }[];
  /** Total runs, for the tooltip's share. */
  total: number;
  /** Percentile lines; null (that share of runs never finishes) hides one. */
  p50: number | null;
  p85: number | null;
  p95: number | null;
  /** Sprints that fit before the target date; null hides the line. */
  target: number | null;
}

// Theme variables, so the lines read on the light theme and in PNG exports.
const { cyan, amber, red, green } = chartTheme.colors;

export function SimulationHistogramChart({
  histogram,
  total,
  p50,
  p85,
  p95,
  target,
}: SimulationHistogramChartProps) {
  const percentiles = [
    { x: p50, name: "P50", colour: cyan },
    { x: p85, name: "P85", colour: amber },
    { x: p95, name: "P95", colour: red },
  ];
  return (
    <ResponsiveContainer width="100%" height={350}>
      <BarChart
        data={histogram}
        margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
        barSize={histogram.length > 30 ? 4 : histogram.length > 15 ? 8 : 16}
        // ChartFigure hides the plot from assistive tech behind its summary
        // and table, so the SVG mustn't be a tab stop.
        accessibilityLayer={false}
      >
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} vertical={false} />
        <XAxis
          dataKey="sprints"
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          tickLine={false}
          label={{
            value: "Sprints needed",
            position: "insideBottomRight",
            offset: -10,
            fill: chartTheme.axisColor,
            fontSize: 12,
          }}
        />
        <YAxis
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          label={{
            value: "Runs",
            angle: -90,
            position: "insideLeft",
            fill: chartTheme.axisColor,
            fontSize: 12,
            offset: 10,
          }}
        />
        <Tooltip content={<HistogramTooltip total={total} />} />

        {percentiles.map(({ x, name, colour }) =>
          x === null ? null : (
            <ReferenceLine
              key={name}
              x={x}
              stroke={colour}
              strokeWidth={2}
              strokeDasharray="5 3"
              label={{ value: name, position: "top", fill: colour, fontSize: 12, fontWeight: 600 }}
            />
          )
        )}

        {/* The sprints that fit before the target date, when one is set. */}
        {target !== null && (
          <ReferenceLine
            x={target}
            stroke={green}
            strokeWidth={2}
            label={{
              value: "Target",
              position: "insideTop",
              fill: green,
              fontSize: 12,
              fontWeight: 600,
            }}
          />
        )}

        <Bar dataKey="count" fill={cyan} fillOpacity={0.7} radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
