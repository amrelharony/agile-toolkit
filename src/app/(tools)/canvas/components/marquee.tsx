"use client";

import type { Camera } from "@/lib/geometry/bbox";
import { rectFromCorners } from "@/lib/geometry/bbox";
import type { MarqueeState } from "../use-canvas-store";

/**
 * Rubber-band selection rectangle.
 *
 * Renders in SCREEN space (after the world transform is undone) so its
 * line thickness stays 1px regardless of zoom. The marquee state's
 * start/current coords are WORLD coords; we project to screen here.
 */
export function Marquee({ marquee, camera }: { marquee: MarqueeState; camera: Camera }) {
  const rect = rectFromCorners(marquee.startWorld, marquee.currentWorld);
  // Project world rect → screen rect.
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
