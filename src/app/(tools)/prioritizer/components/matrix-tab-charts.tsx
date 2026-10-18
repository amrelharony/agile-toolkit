"use client";

// Recharts lives here so the Prioritizer loads it only when the Value vs.
// Effort scatter mounts. Import this module through next/dynamic.
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";

export interface ScatterPayload {
  name: string;
  value: number;
  matrixEffort: number;
}

function MatrixTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ScatterPayload }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={chartTheme.tooltipStyle} className="px-3 py-2 min-w-[140px]">
      <p className="font-semibold mb-1" style={{ color: "#e2e8f0" }}>
        {d.name}
      </p>
      <div className="text-xs space-y-0.5">
        <div className="flex justify-between gap-3">
          <span style={{ color: "#94a3b8" }}>Value</span>
          <span style={{ color: "#00f0ff" }} className="font-data">
            {d.value}
          </span>
        </div>
        <div className="flex justify-between gap-3">
          <span style={{ color: "#94a3b8" }}>Effort</span>
          <span style={{ color: "#00f0ff" }} className="font-data">
            {d.matrixEffort}
          </span>
        </div>
      </div>
    </div>
  );
}

interface ValueEffortScatterProps {
  data: ScatterPayload[];
  /** Injected by ChartCard's ResponsiveContainer. */
  width?: number;
  height?: number;
}

export function ValueEffortScatter({ data, width, height }: ValueEffortScatterProps) {
  return (
    <ScatterChart
      width={width}
      height={height}
      margin={{ top: 20, right: 30, bottom: 20, left: 10 }}
    >
      <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} />
      <XAxis
        type="number"
        dataKey="matrixEffort"
        domain={[0, 11]}
        tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
        axisLine={{ stroke: chartTheme.gridColor }}
        tickLine={false}
        label={{
          value: "Effort →",
          position: "insideBottomRight",
          offset: -5,
          fill: chartTheme.axisColor,
          fontSize: 11,
        }}
        ticks={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]}
      />
      <YAxis
        type="number"
        dataKey="value"
        domain={[0, 11]}
        tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
        axisLine={false}
        tickLine={false}
        label={{
          value: "Value ↑",
          angle: -90,
          position: "insideLeft",
          fill: chartTheme.axisColor,
          fontSize: 11,
          offset: 10,
        }}
        ticks={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]}
      />
      <Tooltip content={<MatrixTooltip />} cursor={{ strokeDasharray: "3 3" }} />

      {/* Quadrant dividers */}
      <ReferenceLine x={5} stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
      <ReferenceLine y={5} stroke="rgba(255,255,255,0.15)" strokeWidth={1} />

      <Scatter data={data} fill="#00f0ff" fillOpacity={0.85} r={6} />
    </ScatterChart>
  );
}
