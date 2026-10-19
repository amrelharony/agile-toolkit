"use client";

// Recharts lives here so the cycle-time page loads it only when a chart
// mounts. Import this module through next/dynamic, never statically.
import {
  BarChart,
  Bar,
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
import type { CycleStats, HistogramDatum, ScatterDatum } from "./types";
import { BUCKETS } from "./helpers";
import { HistogramTooltip, ScatterTooltip } from "./components/chart-tooltips";

/** Cycle-time distribution across fixed day-buckets with P50/P85/P95 markers. */
export function CycleTimeHistogramChart({
  histogramData,
  stats,
  percentileMap,
}: {
  histogramData: HistogramDatum[];
  stats: CycleStats;
  percentileMap: Record<number, number>;
}) {
  return (
    <ResponsiveContainer width="100%" height={380}>
      <BarChart data={histogramData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis
          dataKey="bucket"
          tick={{ fill: "#94a3b8", fontSize: 11 }}
          axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: "#94a3b8", fontSize: 12 }}
          axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
          tickLine={false}
          allowDecimals={false}
          label={{
            value: "Items",
            angle: -90,
            position: "insideLeft",
            fill: "#94a3b8",
            fontSize: 12,
          }}
        />
        <Tooltip content={<HistogramTooltip />} />
        <Bar dataKey="count" fill="#00f0ff" fillOpacity={0.8} radius={[4, 4, 0, 0]} />
        {/* Each percentile marker is rendered ONLY when its
              value lands inside a defined histogram bucket. The
              previous version passed `x={undefined}` to Recharts
              when no bucket matched (e.g. all items completed in
              0d, P95 falls below the 1-day bucket), which threw
              console warnings and rendered phantom lines. */}
        {(() => {
          const idx = BUCKETS.findIndex((b) => stats.median >= b.min && stats.median <= b.max);
          return idx >= 0 ? (
            <ReferenceLine
              x={BUCKETS[idx].label}
              stroke="#00f0ff"
              strokeDasharray="4 2"
              label={{ value: "P50", fill: "#00f0ff", fontSize: 10 }}
            />
          ) : null;
        })()}
        {(() => {
          const idx = BUCKETS.findIndex((b) => stats.p85 >= b.min && stats.p85 <= b.max);
          return idx >= 0 ? (
            <ReferenceLine
              x={BUCKETS[idx].label}
              stroke="#f59e0b"
              strokeDasharray="4 2"
              label={{ value: "P85", fill: "#f59e0b", fontSize: 10 }}
            />
          ) : null;
        })()}
        {(() => {
          const idx = BUCKETS.findIndex(
            (b) => percentileMap[95] >= b.min && percentileMap[95] <= b.max
          );
          return idx >= 0 ? (
            <ReferenceLine
              x={BUCKETS[idx].label}
              stroke="#ef4444"
              strokeDasharray="4 2"
              label={{ value: "P95", fill: "#ef4444", fontSize: 10 }}
            />
          ) : null;
        })()}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Per-item cycle time vs insertion order, with percentile and CUSUM markers. */
export function CycleTimeScatterChart({
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
