"use client";

/**
 * Tab 4 — Value vs. Effort matrix. A scatter of items (Value Y, Effort X) with
 * quadrant dividers + legend, plus an item list colored by quadrant.
 */

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { ChartCard } from "@/components/shared/chart-card";
import { withBacklogDefaults } from "@/lib/prioritization/frameworks";
import type { BacklogItem } from "../types";
import { matrixQuadrant, type MatrixQuadrant } from "../scoring";

const QUADRANT_COLORS: Record<MatrixQuadrant, string> = {
  "Quick Wins": "#00ff88",
  "Major Projects": "#00f0ff",
  "Fill-ins": "#ffaa00",
  "Time Sinks": "#ef4444",
};

// Recharts loads with the scatter, not the page. ChartCard's fixed-height
// box holds the space while it loads.
const ValueEffortScatter = dynamic(
  () => import("./matrix-tab-charts").then((m) => m.ValueEffortScatter),
  { ssr: false }
);

export function MatrixTab({ items: stored }: { items: BacklogItem[] }) {
  // Phase 7 engine replaces this: a missing input shows its old default.
  const items = useMemo(() => stored.map(withBacklogDefaults), [stored]);
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
              // The same quadrants as the "All methods" tab.
              const color = QUADRANT_COLORS[matrixQuadrant(item.value, item.matrixEffort)];
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
      <ValueEffortScatter data={data} />
    </ChartCard>
  );
}
