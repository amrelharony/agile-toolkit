"use client";

import type { Camera } from "@/lib/geometry/bbox";
import { rectFromCorners } from "@/lib/geometry/bbox";
import type { MarqueeState } from "../use-canvas-store";

/**
 * Rubber-band selection rectangle OR freeform lasso polygon.
 *
 * Renders in SCREEN space (after the world transform is undone) so its
 * line thickness stays 1px regardless of zoom. The marquee state's
 * start/current coords are WORLD coords; we project to screen here.
 *
 * When `marquee.lassoPoints` is set, renders a smooth SVG polyline
 * instead of the rectangle — used by Alt-drag lasso selection.
 */
export function Marquee({ marquee, camera }: { marquee: MarqueeState; camera: Camera }) {
  // Lasso mode — render the polyline path.
  if (marquee.lassoPoints && marquee.lassoPoints.length >= 4) {
    const pts = marquee.lassoPoints;
    // Project world points → screen and emit `M x y L x y L x y …` for
    // the SVG path. Z closes the loop visually so the user sees the
    // hit region exactly.
    let d = "";
    for (let i = 0; i < pts.length; i += 2) {
      const sx = (pts[i] - camera.x) * camera.zoom;
      const sy = (pts[i + 1] - camera.y) * camera.zoom;
      d += `${i === 0 ? "M" : "L"} ${sx} ${sy} `;
    }
    d += "Z";
    return (
      <svg
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 1,
          height: 1,
          overflow: "visible",
          pointerEvents: "none",
          zIndex: 9999,
        }}
      >
        <path
          d={d}
          fill="rgba(0, 240, 255, 0.08)"
          stroke="#00f0ff"
          strokeWidth={1}
          strokeDasharray="4 3"
        />
      </svg>
    );
  }
  // Rect mode — original rubber-band.
  const rect = rectFromCorners(marquee.startWorld, marquee.currentWorld);
  const x = (rect.x - camera.x) * camera.zoom;
  const y = (rect.y - camera.y) * camera.zoom;
  const w = rect.w * camera.zoom;
  const h = rect.h * camera.zoom;
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: w,
        height: h,
        border: "1px solid #00f0ff",
        background: "rgba(0, 240, 255, 0.08)",
        pointerEvents: "none",
        zIndex: 9999,
      }}
    />
  );
}
