"use client";

/**
 * The stacked cumulative-flow area chart (one Area per status column), with an
 * optional WIP-limit reference line. Renders an empty-state when there are no
 * snapshots yet.
 */

import {
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { BarChart2 } from "lucide-react";
import type { StatusColumn } from "../types";
import { CFDTooltip } from "./cfd-tooltip";

export function FlowChart({
  chartData,
  columns,
  wipLimit,
}: {
  chartData: Record<string, string | number>[];
  columns: StatusColumn[];
  wipLimit: number | null;
}) {
  if (chartData.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-sub gap-3">
        <BarChart2 className="w-12 h-12 opacity-20" />
        <p className="text-sm">Add date entries below to see the chart</p>
      </div>
    );
  }

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
        <Legend wrapperStyle={{ fontSize: 12, color: "#94a3b8", paddingTop: 12 }} />
        {wipLimit !== null && (
          <ReferenceLine
            y={wipLimit}
            stroke="#ef4444"
            strokeDasharray="6 3"
            label={{ value: `WIP Limit: ${wipLimit}`, fill: "#ef4444", fontSize: 11 }}
          />
        )}
        {columns.map((col) => (
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
