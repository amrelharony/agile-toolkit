"use client";

/**
 * Line / arrow object view. Extracted verbatim from object-renderer's
 * line/arrow case — renders into a bounding-box SVG, adding an arrowhead
 * polygon for arrows.
 */

import React from "react";
import type { WhiteboardLine } from "@/lib/stores/workspace-types";
import { arrowheadPoints } from "../../lib/object-render-utils";
import { LockBadge } from "./object-render-primitives";
import type { ObjectViewBaseProps } from "./object-view-shared";

export function LineObject({
  object: o,
  selected,
  onPointerDown,
}: ObjectViewBaseProps & { object: WhiteboardLine }) {
  const handle = (e: React.PointerEvent) => onPointerDown?.(e, o.id);
  const selectionStyle = selected
    ? { boxShadow: "0 0 0 2px #00f0ff, 0 0 12px rgba(0,240,255,0.4)" }
    : undefined;

  // World coords: (x, y) start; (x+w, y+h) end. We render into a
  // bounding-box SVG and align with absolute positioning.
  const minX = Math.min(0, o.w);
  const minY = Math.min(0, o.h);
  const w = Math.abs(o.w);
  const h = Math.abs(o.h);
  const sx = -minX;
  const sy = -minY;
  const ex = sx + o.w;
  const ey = sy + o.h;
  return (
    <div
      onPointerDown={handle}
      data-canvas-object-kind={o.type}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        transform: `translate3d(${o.x + minX}px, ${o.y + minY}px, 0)`,
        width: w || 1,
        height: h || 1,
        cursor: o.locked ? "default" : "move",
        zIndex: o.z,
        opacity: o.locked ? 0.85 : 1,
        ...selectionStyle,
      }}
    >
      <svg width="100%" height="100%" overflow="visible">
        <line
          x1={sx}
          y1={sy}
          x2={ex}
          y2={ey}
          stroke={o.stroke}
          strokeWidth={o.strokeWidth}
          strokeDasharray={o.dashed ? "6 4" : undefined}
        />
        {o.type === "arrow" && (
          <polygon
            points={arrowheadPoints(
              { x: ex, y: ey },
              { x: o.w, y: o.h },
              Math.max(8, o.strokeWidth * 3)
            )}
            fill={o.stroke}
          />
        )}
      </svg>
      {o.locked && <LockBadge z={o.z} />}
    </div>
  );
}
