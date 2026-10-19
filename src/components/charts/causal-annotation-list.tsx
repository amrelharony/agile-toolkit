"use client";

import { useState } from "react";
import Link from "next/link";

/*
 * Cross-tool annotation data and the list renderer. No Recharts here, so
 * a page can show the list without loading the chart library; the chart
 * overlays (CausalLine, CausalMarker) live in ./causal-annotation.
 */

export type CausalConfidence = "weak" | "moderate" | "strong";

export interface CausalAnnotationData {
  /** X-axis position (must match the chart's x-axis dataKey). */
  x: number | string;
  /** Short headline. */
  label: string;
  /** Longer detail surfaced in tooltip / drawer. */
  detail: string;
  /** Where to drill into when the user clicks. */
  link?: { toolId: string; query?: string };
  confidence: CausalConfidence;
  /** Optional Y position for the dot; defaults to series-mid. */
  y?: number;
}

export const CONFIDENCE_COLOR: Record<CausalConfidence, string> = {
  weak: "var(--sub)",
  moderate: "var(--chart-4)",
  strong: "var(--destructive)",
};

/**
 * Side-panel renderer to surface the annotations as a list. Useful for
 * tools whose chart is too dense to overlay markers on. Renders nothing
 * when the list is empty.
 */
export function CausalAnnotationList({ annotations }: { annotations: CausalAnnotationData[] }) {
  // Track the expanded item by a stable composite of x + label rather than
  // by array index. If a parent re-orders or filters annotations while one
  // is open, an index would point at a different annotation; the composite
  // either matches the original entry or no entry (which collapses cleanly).
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  if (annotations.length === 0) return null;
  const keyOf = (a: CausalAnnotationData) => `${a.x}|${a.label}`;
  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="text-xs font-mono uppercase tracking-wider text-sub">Cross-tool signals</div>
      {annotations.map((a) => {
        const color = CONFIDENCE_COLOR[a.confidence];
        const k = keyOf(a);
        const open = expandedKey === k;
        return (
          <div
            key={k}
            className="border border-border bg-surface rounded-lg p-3 text-xs"
            style={{ borderLeftColor: color, borderLeftWidth: 3 }}
          >
            <button
              type="button"
              onClick={() => setExpandedKey(open ? null : k)}
              className="flex items-start justify-between gap-3 w-full text-left"
              aria-expanded={open}
            >
              <span className="text-text font-medium">{a.label}</span>
              <span className="text-xs uppercase tracking-wider text-sub shrink-0">
                {a.confidence}
              </span>
            </button>
            {open && (
              <div className="mt-2 text-sub whitespace-pre-wrap break-words">
                {a.detail}
                {a.link && (
                  <div className="mt-2">
                    <Link
                      href={`/${a.link.toolId}${a.link.query ? `?${a.link.query}` : ""}`}
                      className="text-accent underline-offset-2 hover:underline"
                    >
                      Open {a.link.toolId} →
                    </Link>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
