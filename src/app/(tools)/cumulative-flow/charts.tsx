"use client";

// Recharts lives here so the cumulative-flow page loads it only when a
// chart mounts. Import this module through next/dynamic, never statically.
import {
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
  ReferenceDot,
  ResponsiveContainer,
  LineChart,
  Line,
} from "recharts";
import { CausalLine, type CausalAnnotationData } from "@/components/charts/causal-annotation";
import type { StatusColumn, WipLimits, WipSeriesPoint, WipSignal } from "./types";
import { CFDTooltip } from "./components/cfd-tooltip";

/**
 * The stacked cumulative-flow area chart (one Area per status column).
 *
 * Recharts stacks areas in render order, first at the bottom. A CFD puts Done
 * at the bottom and the first (start) column on top, so the columns render in
 * reverse workflow order. The legend still lists them in workflow order.
 *
 * There's no WIP-limit line here: the stack's height is every item on the
 * board, not the WIP band, so a limit drawn against it reads wrong. The limit
 * is drawn on the WIP control chart instead.
 */
export function CumulativeFlowAreaChart({
  chartData,
  columns,
}: {
  chartData: Record<string, string | number>[];
  columns: StatusColumn[];
}) {
  const stackOrder = [...columns].reverse();
  const workflowIndex = (name: unknown) => columns.findIndex((c) => c.name === name);
  return (
    <ResponsiveContainer width="100%" height={400}>
      <AreaChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis
          dataKey="date"
          tick={{ fill: "#94a3b8", fontSize: 12 }}
          axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: "#94a3b8", fontSize: 12 }}
          axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
          tickLine={false}
          allowDecimals={false}
        />
        <Tooltip content={<CFDTooltip />} />
        <Legend
          wrapperStyle={{ fontSize: 12, color: "#94a3b8", paddingTop: 12 }}
          itemSorter={(item) => workflowIndex(item.value)}
        />
        {stackOrder.map((col) => (
          <Area
            key={col.id}
            type="monotone"
            dataKey={col.name}
            stackId="1"
            stroke={col.color}
            fill={col.color}
            fillOpacity={0.55}
            strokeWidth={2}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

/**
 * WIP over time with XmR limits, CUSUM markers and out-of-control dots, plus
 * the team's WIP limit when one is set (drawn on the series it limits).
 */
export function WipControlLineChart({
  wipSeries,
  wipLimits,
  wipLimit = null,
  cusumAnnotations,
  signals,
}: {
  wipSeries: WipSeriesPoint[];
  wipLimits: WipLimits | null;
  wipLimit?: number | null;
  cusumAnnotations: CausalAnnotationData[];
  signals: WipSignal[];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={wipSeries} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis
          dataKey="date"
          tick={{ fill: "#94a3b8", fontSize: 11 }}
          axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: "#94a3b8", fontSize: 11 }}
          axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
          tickLine={false}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontSize: 12,
          }}
          labelStyle={{ color: "var(--sub)" }}
        />
        {wipLimits && (
          <>
            <ReferenceLine
              y={wipLimits.centerLine}
              stroke="var(--sub)"
              strokeDasharray="2 4"
              label={{
                value: `X̄ ${wipLimits.centerLine.toFixed(1)}`,
                fill: "var(--sub)",
                fontSize: 10,
                position: "right",
              }}
            />
            <ReferenceLine
              y={wipLimits.ucl}
              stroke="#ef4444"
              strokeDasharray="4 2"
              label={{
                value: `UCL ${wipLimits.ucl.toFixed(1)}`,
                fill: "#ef4444",
                fontSize: 10,
                position: "right",
              }}
            />
            <ReferenceLine
              y={wipLimits.lcl}
              stroke="#ef4444"
              strokeDasharray="4 2"
              label={{
                value: `LCL ${wipLimits.lcl.toFixed(1)}`,
                fill: "#ef4444",
                fontSize: 10,
                position: "right",
              }}
            />
          </>
        )}
        {wipLimit !== null && (
          <ReferenceLine
            y={wipLimit}
            stroke="#f59e0b"
            strokeDasharray="6 3"
            ifOverflow="extendDomain"
            label={{
              value: `WIP limit ${wipLimit}`,
              fill: "#f59e0b",
              fontSize: 10,
              position: "insideTopLeft",
            }}
          />
        )}
        {cusumAnnotations.map((a, i) => (
          <CausalLine key={i} annotation={a} />
        ))}
        {/* Western Electric out-of-control markers — small red
                  dots at the offending sample. Hover hint via the SVG
                  title shows which rule fired. */}
        {signals.map((sig) => {
          const point = wipSeries[sig.index];
          if (!point) return null;
          return (
            <ReferenceDot
              key={`we-${sig.index}-${sig.rule}`}
              x={point.date}
              y={point.value}
              r={4}
              fill="var(--destructive)"
              stroke="var(--destructive)"
              ifOverflow="extendDomain"
            >
              <title>{`${sig.rule}: ${sig.description}`}</title>
            </ReferenceDot>
          );
        })}
        <Line
          type="monotone"
          dataKey="value"
          stroke="#00f0ff"
          strokeWidth={2}
          dot={{ r: 3, fill: "#00f0ff" }}
          activeDot={{ r: 5 }}
          name="WIP"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
