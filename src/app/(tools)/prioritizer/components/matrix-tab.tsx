"use client";

/**
 * Tab Value vs Effort: a scatter of the placed items (value up the side on
 * the Fibonacci steps, effort along the bottom, the quadrant lines where
 * the method's quadrant changes: value 8, effort 6), with a summary and a
 * "View as table", then the items quadrant by quadrant in do-first order
 * and the ones not placed yet. The quadrant is derived by the Value/Effort
 * method, never stored; the scatter is read-only (drag items on the 2×2 in
 * the Value vs Effort tool, or set the values in the table above).
 */

import { useMemo } from "react";
import dynamic from "next/dynamic";
import Link from "@/components/motion/transition-link";
import { ChartFigure } from "@/components/shared/chart-card";
import { SectionCard } from "@/components/shared/section-card";
import { VE_LABEL, VE_MEANING, VE_QUADRANTS } from "@/lib/prioritization/methods/value-effort";
import { cn } from "@/lib/utils";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";
import type { BacklogItem } from "../types";
import { TONE_CLASS, quadrantTone } from "../constants";
import { matrixPoints, matrixText } from "../matrix";
import { itemName } from "../method-text";

const NO_ROWS: readonly PrioritizationItem[] = [];

// Recharts loads with the scatter, not the page. The fixed-height box holds
// the space while it loads.
const ValueEffortScatter = dynamic(
  () => import("./matrix-tab-charts").then((m) => m.ValueEffortScatter),
  { ssr: false }
);

export function MatrixTab({
  items,
  rows = NO_ROWS,
}: {
  items: readonly BacklogItem[];
  /** The workspace's method rows: links made before Phase 7 read through them. */
  rows?: readonly PrioritizationItem[];
}) {
  const { points, unplaced } = useMemo(() => matrixPoints(items, rows), [items, rows]);
  const text = useMemo(() => matrixText(points, unplaced.length), [points, unplaced.length]);

  return (
    <SectionCard title="Value vs. Effort Matrix">
      <ChartFigure
        label="Value vs effort"
        summary={text.summary}
        table={text.table}
        plotClassName="h-[360px]"
      >
        {points.length > 0 ? (
          <ValueEffortScatter points={points} />
        ) : (
          <p className="flex h-full items-center justify-center text-sm text-sub">
            Nothing placed yet.
          </p>
        )}
      </ChartFigure>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {VE_QUADRANTS.map((q) => {
          const tone = TONE_CLASS[quadrantTone(q)];
          const inQ = points.filter((p) => p.quadrant === q);
          return (
            <section
              key={q}
              aria-label={VE_LABEL[q]}
              className={cn("rounded-lg border p-3", tone.border, tone.bg)}
            >
              <h3 className={cn("text-xs font-semibold", tone.text)}>
                {VE_LABEL[q]} ({inQ.length})
              </h3>
              <p className="mt-0.5 text-xs text-sub">{VE_MEANING[q]}</p>
              {inQ.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm">
                  {inQ.map((p) => (
                    <li key={p.id} className="flex flex-wrap justify-between gap-x-3">
                      <span className="min-w-0 break-words text-text">{itemName(p.name, 60)}</span>
                      <span className="font-data text-xs text-sub">
                        value {p.value} · effort {p.effort}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {unplaced.length > 0 && (
        <p className="mt-3 text-xs text-sub">
          Not placed yet: {unplaced.map((i) => itemName(i.name)).join(", ")}. Give each a value and
          an effort in the table above, or place them on the{" "}
          <Link
            href="/value-effort-matrix"
            className="text-accent underline-offset-2 hover:underline"
          >
            Value vs Effort matrix
          </Link>
          .
        </p>
      )}
    </SectionCard>
  );
}
