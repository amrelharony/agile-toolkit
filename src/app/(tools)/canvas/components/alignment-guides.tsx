"use client";

import { memo } from "react";
import type { Camera } from "@/lib/geometry/bbox";
import type { AlignmentGuide } from "@/lib/whiteboard/snap";

interface AlignmentGuidesProps {
  guides: readonly AlignmentGuide[];
  camera: Camera;
}

/**
 * Cyan guide lines extending across the canvas during drag — drawn at
 * the moment the dragged object's edge / center aligns with another
 * object's edge / center. The snap engine returns these in world
 * coordinates; we project to screen here so the lines stay 1 px at any
 * zoom and naturally clip to the viewport.
 */
function AlignmentGuidesImpl({ guides, camera }: AlignmentGuidesProps) {
  if (guides.length === 0) return null;
  return (
    <svg
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 9997,
      }}
    >
      {guides.map((g, i) => {
        if (g.orientation === "vertical") {
          const x = (g.position - camera.x) * camera.zoom;
          const y1 = (g.rangeMin - camera.y) * camera.zoom;
          const y2 = (g.rangeMax - camera.y) * camera.zoom;
          return (
            <line key={i} x1={x} y1={y1} x2={x} y2={y2}
              stroke="#00f0ff" strokeWidth={1} strokeDasharray="3 3" />
          );
        }
        const y = (g.position - camera.y) * camera.zoom;
        const x1 = (g.rangeMin - camera.x) * camera.zoom;
        const x2 = (g.rangeMax - camera.x) * camera.zoom;
        return (
          <line key={i} x1={x1} y1={y} x2={x2} y2={y}
            stroke="#00f0ff" strokeWidth={1} strokeDasharray="3 3" />
        );
      })}
    </svg>
  );
}

export const AlignmentGuides = memo(AlignmentGuidesImpl);
