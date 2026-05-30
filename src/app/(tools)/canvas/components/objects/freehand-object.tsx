"use client";

/**
 * Freehand stroke object view. Extracted verbatim from object-renderer's
 * `case "freehand"` — renders a perfect-freehand filled path for stylus
 * strokes (with pressures) or a polyline for legacy/mouse strokes.
 */

import React from "react";
import type { WhiteboardFreehand } from "@/lib/stores/workspace-types";
import { flatPointsToPath } from "@/lib/whiteboard/freehand";
import { LockBadge } from "./object-render-primitives";
import type { ObjectViewBaseProps } from "./object-view-shared";

export function FreehandObject({
  object: o,
  selected,
  onPointerDown,
}: ObjectViewBaseProps & { object: WhiteboardFreehand }) {
  const handle = (e: React.PointerEvent) => onPointerDown?.(e, o.id);
  const selectionStyle = selected
    ? { boxShadow: "0 0 0 2px #00f0ff, 0 0 12px rgba(0,240,255,0.4)" }
    : undefined;

  // We draw freehand objects as their own SVG path inside a div that
  // covers the object's bbox in world coords. Points are world-coords;
  // shift them into the local svg coord system. Strokes without a
  // `pressures` array (legacy / mouse / non-pressure touch) render
  // as a polyline; strokes WITH `pressures` (stylus) go through
  // perfect-freehand so the contour tapers with pen pressure.
  const { points } = o;
  if (points.length < 4) return null;
  const pressures = o.pressures;
  const hasPressures = Array.isArray(pressures) && pressures.length === points.length / 2;

  let svgInner: React.ReactNode;
  if (hasPressures) {
    // Interleave the parallel pressures with x,y pairs to feed
    // perfect-freehand's stride-3 expectation, translating into the
    // object's local coord system in the same pass.
    const local: number[] = [];
    for (let i = 0, p = 0; i + 1 < points.length; i += 2, p += 1) {
      local.push(points[i] - o.x, points[i + 1] - o.y, pressures![p]);
    }
    // perfect-freehand's `size` is the width at default pressure 0.5
    // (with default thinning 0.5). So `size = strokeWidth` produces a
    // committed path whose mid-pressure visual width matches the
    // existing strokeWidth polyline — no jump on pointer-up.
    const d = flatPointsToPath(local, { size: o.strokeWidth }, true);
    svgInner = <path d={d} fill={o.stroke} stroke="none" />;
  } else {
    const d = points
      .map((v, i) => (i % 2 === 0 ? `${i === 0 ? "M" : "L"}${v - o.x}` : ` ${v - o.y}`))
      .join("");
    svgInner = (
      <path
        d={d}
        fill="none"
        stroke={o.stroke}
        strokeWidth={o.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  }

  return (
    <div
      onPointerDown={handle}
      data-canvas-object-kind="freehand"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        transform: `translate3d(${o.x}px, ${o.y}px, 0)`,
        width: o.w || 1,
        height: o.h || 1,
        cursor: o.locked ? "default" : "move",
        zIndex: o.z,
        opacity: o.locked ? 0.85 : 1,
        ...selectionStyle,
      }}
    >
      <svg width="100%" height="100%" overflow="visible">
        {svgInner}
      </svg>
      {o.locked && <LockBadge z={o.z} />}
    </div>
  );
}
