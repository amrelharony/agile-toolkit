"use client";

import { ReferenceLine, ReferenceDot } from "recharts";
import { CONFIDENCE_COLOR, type CausalAnnotationData } from "./causal-annotation-list";

// Re-exported so existing imports keep working. Pages that only need the
// list should import ./causal-annotation-list: this module loads Recharts.
export {
  CausalAnnotationList,
  CONFIDENCE_COLOR,
  type CausalAnnotationData,
  type CausalConfidence,
} from "./causal-annotation-list";

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
