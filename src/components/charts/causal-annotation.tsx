"use client";

import { useState } from "react";
import Link from "next/link";
import { ReferenceLine, ReferenceDot } from "recharts";

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

const CONFIDENCE_COLOR: Record<CausalConfidence, string> = {
  weak: "var(--sub)",
  moderate: "var(--chart-4)",
  strong: "var(--destructive)",
};

interface CausalLineProps {
  annotation: CausalAnnotationData;
}

/**
 * Vertical reference line + dot on a Recharts canvas. Use INSIDE the chart
 * component (e.g., `<LineChart>{annotations.map(a => <CausalLine .../>)}`)
 * because Recharts only honours `<ReferenceLine>` rendered as a child.
 */
export function CausalLine({ annotation }: CausalLineProps) {
  const color = CONFIDENCE_COLOR[annotation.confidence];
  return (
    <ReferenceLine
      x={annotation.x}
      stroke={color}
      strokeDasharray="3 3"
      strokeOpacity={0.6}
      ifOverflow="extendDomain"
    />
  );
}

/**
 * Optional "dot + label" form when you want a clickable marker on the
 * series (rather than a vertical sweep across the whole canvas).
 */
export function CausalMarker({ annotation }: CausalLineProps) {
  const color = CONFIDENCE_COLOR[annotation.confidence];
  return (
    <ReferenceDot
      x={annotation.x}
      y={annotation.y ?? 0}
      r={5}
      fill={color}
      stroke="var(--bg)"
      strokeWidth={2}
      ifOverflow="extendDomain"
    />
  );
}

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
      <div className="text-[11px] font-mono uppercase tracking-wider text-sub">
        Cross-tool signals
      </div>
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
              <span className="text-[10px] uppercase tracking-wider text-sub shrink-0">
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
