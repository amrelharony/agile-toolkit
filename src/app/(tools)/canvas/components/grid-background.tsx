"use client";

/**
 * Background grid layer for the whiteboard viewport.
 *
 * Wrapped in React.memo so the grid only re-renders when camera or
 * viewport size *content* changes — not just because the parent
 * WhiteboardCanvas re-rendered (e.g. on a selection change). The grid
 * is cheap but the inline style object is large; saving the reconcile
 * is worth the memo. Drawn via CSS background-image (major + minor
 * lines sized to zoom) so it's free in React reconciliation terms.
 */

import { memo } from "react";

export const GridBackground = memo(function GridBackgroundImpl({
  camera,
  viewportSize,
}: {
  camera: { x: number; y: number; zoom: number };
  viewportSize: { w: number; h: number };
}) {
  // Major + minor grid, sized to current zoom. We draw via a CSS background
  // so it's free in terms of React reconciliation cost.
  const minor = 20 * camera.zoom;
  const major = minor * 5;
  const offsetX = (-camera.x * camera.zoom) % major;
  const offsetY = (-camera.y * camera.zoom) % major;
  if (viewportSize.w === 0) return null;
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        backgroundImage: `
          linear-gradient(rgba(148, 163, 184, 0.06) 1px, transparent 1px),
          linear-gradient(90deg, rgba(148, 163, 184, 0.06) 1px, transparent 1px),
          linear-gradient(rgba(148, 163, 184, 0.12) 1px, transparent 1px),
          linear-gradient(90deg, rgba(148, 163, 184, 0.12) 1px, transparent 1px)
        `,
        backgroundSize: `${minor}px ${minor}px, ${minor}px ${minor}px, ${major}px ${major}px, ${major}px ${major}px`,
        backgroundPosition: `${offsetX}px ${offsetY}px, ${offsetX}px ${offsetY}px, ${offsetX}px ${offsetY}px, ${offsetX}px ${offsetY}px`,
      }}
    />
  );
});
