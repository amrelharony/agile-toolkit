"use client";

/**
 * Scatter view: per-item cycle time vs insertion order, with P50/P85/P95
 * reference lines and CUSUM regime-shift markers.
 */

import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  Label as RechartsLabel,
} from "recharts";
import { CausalLine, type CausalAnnotationData } from "@/components/charts/causal-annotation";
import type { CycleStats, ScatterDatum } from "../types";
import { ScatterTooltip } from "./chart-tooltips";

export function ScatterTab({
  scatterData,
  stats,
  percentileMap,
  cusumAnnotations,
}: {
  scatterData: ScatterDatum[];
  stats: CycleStats;
  percentileMap: Record<number, number>;
  cusumAnnotations: CausalAnnotationData[];
}) {
  return (
    <ResponsiveContainer width="100%" height={380}>
      <ScatterChart margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis
          dataKey="idx"
          type="number"
          name="Item #"
          tick={{ fill: "#94a3b8", fontSize: 12 }}
          axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
          tickLine={false}
          allowDecimals={false}
        >
          <RechartsLabel
            value="Item #"
            offset={-10}
            position="insideBottom"
            fill="#94a3b8"
            fontSize={12}
          />
        </XAxis>
        <YAxis
          dataKey="cycleTime"
          type="number"
          name="Days"
          tick={{ fill: "#94a3b8", fontSize: 12 }}
          axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
          tickLine={false}
          label={{
            value: "Cycle Time (days)",
            angle: -90,
            position: "insideLeft",
            fill: "#94a3b8",
            fontSize: 12,
          }}
        />
        <Tooltip content={<ScatterTooltip />} />
        <ReferenceLine
          y={stats.median}
          stroke="#00f0ff"
          strokeDasharray="5 3"
          label={{
            value: `P50 (${stats.median}d)`,
            fill: "#00f0ff",
            fontSize: 10,
            position: "right",
          }}
        />
        <ReferenceLine
          y={stats.p85}
          stroke="#f59e0b"
          strokeDasharray="5 3"
          label={{
            value: `P85 (${stats.p85}d)`,
            fill: "#f59e0b",
            fontSize: 10,
            position: "right",
          }}
        />
        <ReferenceLine
          y={percentileMap[95]}
          stroke="#ef4444"
          strokeDasharray="5 3"
          label={{
            value: `P95 (${percentileMap[95]}d)`,
            fill: "#ef4444",
            fontSize: 10,
            position: "right",
          }}
        />
        {cusumAnnotations.map((a, i) => (
          <CausalLine key={i} annotation={a} />
        ))}
        <Scatter data={scatterData} fill="#00f0ff" fillOpacity={0.8} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}
