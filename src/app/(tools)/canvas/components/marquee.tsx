"use client";

import type { Camera } from "@/lib/geometry/bbox";
import { rectFromCorners } from "@/lib/geometry/bbox";
import type { MarqueeState } from "../use-canvas-store";

// Mirrors LASSO_MAX_POINTS in use-canvas-pointer-machine.ts. When the
// buffer fills, the pointer-machine silently drops further points; we
// surface that to the user via a small indicator so a long, careful
// lasso doesn't end with a "why didn't it select what I traced?"
// confusion. Threshold at 90% — leaves a tiny buffer for the warning
// to land before the cap actually bites.
const LASSO_MAX_POINTS = 1000;
const LASSO_WARN_THRESHOLD = LASSO_MAX_POINTS * 0.9;

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
    const pointCount = pts.length / 2;
    const atCap = pointCount >= LASSO_MAX_POINTS;
    const nearCap = pointCount >= LASSO_WARN_THRESHOLD;
    // Project world points → screen and emit `M x y L x y L x y …` for
    // the SVG path. Z closes the loop visually so the user sees the
    // hit region exactly.
    //
    // Path assembly uses an array + join rather than `+=` string
    // concatenation in a loop — for a long lasso with 1000+ points
    // (slow careful drag), `+=` becomes O(n²) due to repeated
    // allocation of the intermediate strings, which can stutter the
    // input thread mid-drag. Pre-sized array stays O(n).
    const parts: string[] = new Array(pts.length / 2);
    for (let i = 0; i < pts.length; i += 2) {
      const sx = (pts[i] - camera.x) * camera.zoom;
      const sy = (pts[i + 1] - camera.y) * camera.zoom;
      parts[i / 2] = `${i === 0 ? "M" : "L"} ${sx} ${sy}`;
    }
    const d = parts.join(" ") + " Z";
    // Latest screen-space point — used to anchor the cap warning near
    // the user's cursor instead of off in some random viewport corner.
    const tipX = (pts[pts.length - 2] - camera.x) * camera.zoom;
    const tipY = (pts[pts.length - 1] - camera.y) * camera.zoom;
    return (
      <>
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
            fill={
              atCap
                ? "rgba(245, 158, 11, 0.10)"
                : "color-mix(in srgb, var(--accent) 8%, transparent)"
            }
            stroke={atCap ? "#f59e0b" : "var(--accent)"}
            strokeWidth={1}
            strokeDasharray="4 3"
          />
        </svg>
        {nearCap && (
          <div
            // Cap warning: at 90% of LASSO_MAX_POINTS we colour the
            // path amber and float a tiny "lasso full" pill near the
            // current cursor. Click-through ignored (pointerEvents:
            // none) so it can't intercept the in-flight drag.
            data-canvas-export-ignore="true"
            aria-live="polite"
            style={{
              position: "absolute",
              left: tipX + 12,
              top: tipY + 12,
              padding: "2px 6px",
              borderRadius: 4,
              background: atCap ? "rgba(245, 158, 11, 0.95)" : "rgba(245, 158, 11, 0.75)",
              color: "#0b0f17",
              fontFamily: "ui-monospace, SF Mono, monospace",
              fontSize: 10,
              fontWeight: 600,
              pointerEvents: "none",
              zIndex: 10000,
              whiteSpace: "nowrap",
              boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
            }}
          >
            {atCap ? "Lasso full — release to select" : `Lasso ${pointCount}/${LASSO_MAX_POINTS}`}
          </div>
        )}
      </>
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
        border: "1px solid var(--accent)",
        background: "color-mix(in srgb, var(--accent) 8%, transparent)",
        pointerEvents: "none",
        zIndex: 9999,
      }}
    />
  );
}
