"use client";

/**
 * Histogram view: cycle-time distribution across fixed day-buckets, with
 * P50/P85/P95 reference lines drawn only when the percentile lands inside a
 * defined bucket, plus a legend.
 */

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import type { CycleStats, HistogramDatum } from "../types";
import { BUCKETS } from "../helpers";
import { HistogramTooltip } from "./chart-tooltips";

export function HistogramTab({
  histogramData,
  stats,
  percentileMap,
}: {
  histogramData: HistogramDatum[];
  stats: CycleStats;
  percentileMap: Record<number, number>;
}) {
  return (
    <>
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
      <div className="flex items-center gap-4 mt-3 text-xs text-sub">
        <span className="flex items-center gap-1.5">
          <span className="w-5 border-t border-dashed border-accent" />
          P50 ({stats.median}d)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-5 border-t border-dashed border-amber-400" />
          P85 ({stats.p85}d)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-5 border-t border-dashed border-red-500" />
          P95 ({percentileMap[95]}d)
        </span>
      </div>
    </>
  );
}
