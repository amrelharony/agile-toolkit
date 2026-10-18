"use client";

// Recharts lives here so the burnup page loads it only when the chart
// mounts. Import this module through next/dynamic, never statically.
import {
  ComposedChart,
  Area,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";
import { CausalLine } from "@/components/charts/causal-annotation";
import { chartTheme } from "@/components/charts/chart-theme";

export interface BurnupChartRow {
  day: number;
  scope: number | null;
  completed: number | null;
  forecast: number | undefined;
  band80Lower: number | undefined;
  band80Upper: number | undefined;
}

/* -------------------------------------------------------------------------- */
/*  Custom Tooltip                                                             */
/* -------------------------------------------------------------------------- */

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string; fill?: string }>;
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div style={chartTheme.tooltipStyle} className="px-3 py-2 min-w-[150px]">
      <p className="font-semibold mb-1.5" style={{ color: "#e2e8f0" }}>
        Day {label}
      </p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-3 text-xs">
          <span style={{ color: p.color || p.fill }}>{p.name}</span>
          <span style={{ color: "#e2e8f0" }} className="font-data font-semibold">
            {p.value != null ? `${p.value} pts` : "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

interface BurnupChartProps {
  data: BurnupChartRow[];
  todayDay: number | null;
  changepointDays: Array<{ day: number; direction: "up" | "down" }>;
  /** Injected by ChartCard's ResponsiveContainer. */
  width?: number;
  height?: number;
}

export function BurnupChart({ data, todayDay, changepointDays, width, height }: BurnupChartProps) {
  return (
    <ComposedChart
      width={width}
      height={height}
      data={data}
      margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
    >
      <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} vertical={false} />
      <XAxis
        dataKey="day"
        tickFormatter={(v: number) => `D${v}`}
        tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
        axisLine={{ stroke: chartTheme.gridColor }}
        tickLine={false}
        label={{
          value: "Sprint Day",
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
          value: "Points",
          angle: -90,
          position: "insideLeft",
          fill: chartTheme.axisColor,
          fontSize: 11,
          offset: 10,
        }}
        domain={[0, "auto"]}
      />
      <Tooltip content={<CustomTooltip />} />
      <Legend wrapperStyle={chartTheme.legendStyle} iconType="line" />

      {/* Today marker */}
      {todayDay !== null && (
        <ReferenceLine
          x={todayDay}
          stroke="#ff00aa"
          strokeWidth={2}
          strokeDasharray="5 3"
          label={{
            value: "Today",
            position: "top",
            fill: "#ff00aa",
            fontSize: 11,
            fontWeight: 600,
          }}
        />
      )}

      {/* Bayesian 80% forecast band — drawn before the actual
                      completed area so the lines render on top. The
                      lower-mask Area uses var(--bg) at fillOpacity 1 to clip
                      the upper Area down to a true band rather than a solid
                      wedge from 0. */}
      <Area
        dataKey="band80Upper"
        name="80% forecast"
        stroke="none"
        fill="#00f0ff"
        fillOpacity={0.18}
        connectNulls
        isAnimationActive={false}
      />
      <Area
        dataKey="band80Lower"
        stroke="none"
        fill="var(--bg, #06080f)"
        fillOpacity={1}
        legendType="none"
        connectNulls
        isAnimationActive={false}
      />

      {/* Completed area */}
      <Area
        type="monotone"
        dataKey="completed"
        name="Completed"
        fill="rgba(0,240,255,0.15)"
        stroke="#00f0ff"
        strokeWidth={2.5}
        dot={{ fill: "#00f0ff", r: 4, strokeWidth: 0 }}
        activeDot={{ r: 6, fill: "#00f0ff", strokeWidth: 0 }}
        connectNulls={false}
      />

      {/* Scope line */}
      <Line
        type="stepAfter"
        dataKey="scope"
        name="Scope"
        stroke="#ff00aa"
        strokeWidth={2}
        strokeDasharray="4 4"
        dot={false}
        activeDot={{ r: 5, fill: "#ff00aa", strokeWidth: 0 }}
        connectNulls
      />

      {/* Forecast centre-line (dashed) — paired with the band
                      Area; only renders when the forecast has data. */}
      <Line
        type="monotone"
        dataKey="forecast"
        name="Forecast"
        stroke="#00f0ff"
        strokeWidth={2}
        strokeDasharray="5 5"
        dot={false}
        connectNulls
      />

      {/* CUSUM regime-shift markers on completed-points series. */}
      {changepointDays.map((cp, i) => (
        <CausalLine
          key={`cusum-${cp.day}-${cp.direction}-${i}`}
          annotation={{
            x: cp.day,
            label: `Delivery shift ${cp.direction}`,
            detail: `CUSUM detected a ${cp.direction === "up" ? "sustained acceleration" : "sustained slow-down"} in completed points around day ${cp.day}.`,
            confidence: "moderate",
          }}
        />
      ))}
    </ComposedChart>
  );
}
