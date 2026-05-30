"use client";

/**
 * Tab 4 — Value vs. Effort matrix. A scatter of items (Value Y, Effort X) with
 * quadrant dividers + legend, plus an item list colored by quadrant.
 */

import { useMemo } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { ChartCard } from "@/components/shared/chart-card";
import { chartTheme } from "@/components/charts/chart-theme";
import type { BacklogItem } from "../types";

interface ScatterPayload {
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

export function MatrixTab({ items }: { items: BacklogItem[] }) {
  const data = useMemo(
    () =>
      items.map((i) => ({
        name: i.name,
        value: i.value,
        matrixEffort: i.matrixEffort,
      })),
    [items]
  );

  return (
    <ChartCard
      title="Value vs. Effort Matrix"
      height={420}
      footer={
        <>
          {/* Quadrant legend */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Quick Wins", desc: "Low effort, high value", color: "#00ff88" },
              { label: "Major Projects", desc: "High effort, high value", color: "#00f0ff" },
              { label: "Fill-ins", desc: "Low effort, low value", color: "#ffaa00" },
              { label: "Time Sinks", desc: "High effort, low value", color: "#ef4444" },
            ].map((q) => (
              <div
                key={q.label}
                className="flex items-start gap-2 p-3 rounded-lg"
                style={{
                  background: `${q.color}0d`,
                  border: `1px solid ${q.color}20`,
                }}
              >
                <span
                  className="mt-0.5 inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ background: q.color }}
                />
                <div>
                  <p className="text-xs font-semibold" style={{ color: q.color }}>
                    {q.label}
                  </p>
                  <p className="text-xs text-sub mt-0.5">{q.desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Item list colored by quadrant */}
          <div className="mt-4 space-y-1.5">
            {items.map((item) => {
              const isHighValue = item.value > 5;
              const isLowEffort = item.matrixEffort <= 5;
              const color =
                isHighValue && isLowEffort
                  ? "#00ff88"
                  : isHighValue
                    ? "#00f0ff"
                    : isLowEffort
                      ? "#ffaa00"
                      : "#ef4444";
              return (
                <div key={item.id} className="flex items-center gap-3 text-sm">
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: color }}
                  />
                  <span className="text-text flex-1">{item.name}</span>
                  <span className="text-xs text-sub font-data">
                    V:{item.value} / E:{item.matrixEffort}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      }
    >
      <ScatterChart margin={{ top: 20, right: 30, bottom: 20, left: 10 }}>
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
    </ChartCard>
  );
}
