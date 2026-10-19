"use client";

// Recharts lives here so the Release Planner route loads it only when the
// chart mounts. release-planner-client.tsx imports these via next/dynamic.
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
      <p className="font-semibold mb-1" style={{ color: "#e2e8f0" }}>
        {label} Sprint{label !== 1 ? "s" : ""}
      </p>
      <div className="text-xs space-y-0.5">
        <div className="flex justify-between gap-3">
          <span style={{ color: "#94a3b8" }}>Iterations</span>
          <span style={{ color: "#00f0ff" }} className="font-data">
            {count.toLocaleString()}
          </span>
        </div>
        <div className="flex justify-between gap-3">
          <span style={{ color: "#94a3b8" }}>Frequency</span>
          <span style={{ color: "#00f0ff" }} className="font-data">
            {pct}%
          </span>
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
  /** Total iterations, for the tooltip's frequency %. */
  total: number;
  p50: number;
  p85: number;
  p95: number;
  /** Bootstrap P85 point; null hides the line. */
  bootstrapPoint: number | null;
  /** User-pinned target sprint count; null hides the line. */
  target: number | null;
}

export function SimulationHistogramChart({
  histogram,
  total,
  p50,
  p85,
  p95,
  bootstrapPoint,
  target,
}: SimulationHistogramChartProps) {
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
          tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          tickLine={false}
          label={{
            value: "Sprints needed",
            position: "insideBottomRight",
            offset: -10,
            fill: chartTheme.axisColor,
            fontSize: 11,
          }}
        />
        <YAxis
          tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          label={{
            value: "Frequency",
            angle: -90,
            position: "insideLeft",
            fill: chartTheme.axisColor,
            fontSize: 11,
            offset: 10,
          }}
        />
        <Tooltip content={<HistogramTooltip total={total} />} />

        {/* Percentile reference lines */}
        <ReferenceLine
          x={p50}
          stroke="#00f0ff"
          strokeWidth={2}
          strokeDasharray="5 3"
          label={{
            value: "P50",
            position: "top",
            fill: "#00f0ff",
            fontSize: 10,
            fontWeight: 600,
          }}
        />
        <ReferenceLine
          x={p85}
          stroke="#ffaa00"
          strokeWidth={2}
          strokeDasharray="5 3"
          label={{
            value: "P85",
            position: "top",
            fill: "#ffaa00",
            fontSize: 10,
            fontWeight: 600,
          }}
        />
        <ReferenceLine
          x={p95}
          stroke="#ef4444"
          strokeWidth={2}
          strokeDasharray="5 3"
          label={{
            value: "P95",
            position: "top",
            fill: "#ef4444",
            fontSize: 10,
            fontWeight: 600,
          }}
        />

        {/* Bootstrap P85 reference — non-parametric companion. */}
        {bootstrapPoint !== null && (
          <ReferenceLine
            x={bootstrapPoint}
            stroke="#a78bfa"
            strokeWidth={2}
            strokeDasharray="2 4"
            label={{
              value: "Boot",
              position: "insideTop",
              fill: "#a78bfa",
              fontSize: 10,
              fontWeight: 600,
            }}
          />
        )}

        {/* User-pinned target line — only shown when the user
            enters a positive integer in the SmartInput field. */}
        {target !== null && (
          <ReferenceLine
            x={target}
            stroke="#22c55e"
            strokeWidth={2}
            label={{
              value: "Target",
              position: "insideTop",
              fill: "#22c55e",
              fontSize: 10,
              fontWeight: 600,
            }}
          />
        )}

        <Bar dataKey="count" fill="#00f0ff" fillOpacity={0.7} radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
