"use client";

// Recharts lives here so the Refinement route loads it only when the chart
// mounts. refinement-client.tsx imports these components via next/dynamic.
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from "recharts";

const TOOLTIP_STYLE = {
  backgroundColor: "#1a1f36",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "8px",
  color: "#e2e8f0",
};

export interface PassRatePoint {
  name: string;
  passRate: number;
  story: string;
}

export interface PassRateControlLines {
  centerLinePct: number;
  uclPct: number;
  lclPct: number;
}

interface PassRateTrendChartProps {
  data: PassRatePoint[];
  /** p-chart limits; null when the window is too small to draw them. */
  control: PassRateControlLines | null;
  width?: number;
  height?: number;
}

export function PassRateTrendChart({ data, control, width, height }: PassRateTrendChartProps) {
  return (
    <LineChart
      width={width}
      height={height}
      data={data}
      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
    >
      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
      <XAxis
        dataKey="name"
        tick={{ fill: "#94a3b8", fontSize: 11 }}
        axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
        tickLine={false}
      />
      <YAxis
        domain={[0, 100]}
        tick={{ fill: "#94a3b8", fontSize: 11 }}
        axisLine={false}
        tickLine={false}
        tickFormatter={(v) => `${v}%`}
      />
      <Tooltip
        contentStyle={TOOLTIP_STYLE}
        // BUG-RD3-refinement-1: Recharts may invoke the
        // formatter on a ReferenceLine hover where
        // `props.payload` is undefined. The prior
        // `props.payload.story` threw TypeError and the
        // chart tooltip crashed. Optional-chain through.
        formatter={(v, _name, props) => [
          `${v}%`,
          (props as { payload?: { story?: string } }).payload?.story ?? "",
        ]}
      />
      <ReferenceLine
        y={80}
        stroke="#00ff88"
        strokeDasharray="4 4"
        strokeOpacity={0.5}
        label={{
          value: "80% target",
          fill: "#00ff88",
          fontSize: 10,
          position: "right",
        }}
      />
      {/* p-chart limits — UCL / X̄ / LCL — stable when the rolling
          window has at least 4 saved stories. */}
      {control && (
        <>
          <ReferenceLine
            y={control.centerLinePct}
            stroke="#00f0ff"
            strokeDasharray="2 4"
            strokeOpacity={0.55}
            label={{
              value: "X̄",
              fill: "#00f0ff",
              fontSize: 10,
              position: "right",
            }}
            ifOverflow="extendDomain"
          />
          <ReferenceLine
            y={control.uclPct}
            stroke="#00ff88"
            strokeDasharray="2 4"
            strokeOpacity={0.55}
            label={{
              value: "UCL",
              fill: "#00ff88",
              fontSize: 10,
              position: "right",
            }}
            ifOverflow="extendDomain"
          />
          <ReferenceLine
            y={control.lclPct}
            stroke="#ef4444"
            strokeDasharray="2 4"
            strokeOpacity={0.55}
            label={{
              value: "LCL",
              fill: "#ef4444",
              fontSize: 10,
              position: "right",
            }}
            ifOverflow="extendDomain"
          />
        </>
      )}
      <Line
        type="monotone"
        dataKey="passRate"
        name="Pass Rate"
        stroke="#00f0ff"
        strokeWidth={2}
        dot={{ fill: "#00f0ff", r: 3 }}
        activeDot={{ r: 5 }}
      />
    </LineChart>
  );
}
