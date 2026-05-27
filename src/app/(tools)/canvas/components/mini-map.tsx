"use client";

import { memo, useDeferredValue, useMemo } from "react";
import type { Camera } from "@/lib/geometry/bbox";
import type { WhiteboardObject } from "@/lib/stores/workspace-types";

interface MiniMapProps {
  objects: readonly WhiteboardObject[];
  camera: Camera;
  viewportSize: { w: number; h: number };
  onPan?: (worldX: number, worldY: number) => void;
}

const MINIMAP_W = 200;
const MINIMAP_H = 140;

/**
 * Bottom-right minimap. Renders every object's bbox as a tiny rect plus
 * the current viewport's world rectangle as a cyan outline. Click /
 * drag the minimap to recenter the camera on that world point.
 */
function MiniMapImpl({ objects, camera, viewportSize, onPan }: MiniMapProps) {
  // R11-fix: defer object updates. The mini-map re-renders on every
  // drag frame (1000 SVG rects redrawn @ 60Hz on busy boards). Wrapping
  // `objects` with useDeferredValue lets React deprioritise the mini-
  // map redraw under input-handler load — the viewport rect (which
  // depends on `camera`, NOT `objects`) still updates immediately for
  // the user's pan/zoom feedback, but the object dot field can lag a
  // frame or two without anyone noticing.
  const deferredObjects = useDeferredValue(objects);
  const { worldBbox, scale } = useMemo(() => {
    if (deferredObjects.length === 0) {
      return {
        worldBbox: { x: 0, y: 0, w: MINIMAP_W * 4, h: MINIMAP_H * 4 },
        scale: 0.25,
      };
    }
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const o of deferredObjects) {
      if (o.x < minX) minX = o.x;
      if (o.y < minY) minY = o.y;
      if (o.x + o.w > maxX) maxX = o.x + o.w;
      if (o.y + o.h > maxY) maxY = o.y + o.h;
    }
    // Include the current viewport so the user can always see "where they are."
    const vpX = camera.x;
    const vpY = camera.y;
    const vpW = viewportSize.w / camera.zoom;
    const vpH = viewportSize.h / camera.zoom;
    if (vpX < minX) minX = vpX;
    if (vpY < minY) minY = vpY;
    if (vpX + vpW > maxX) maxX = vpX + vpW;
    if (vpY + vpH > maxY) maxY = vpY + vpH;
    const padding = 40;
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;
    const bbW = maxX - minX || 1;
    const bbH = maxY - minY || 1;
    const s = Math.min(MINIMAP_W / bbW, MINIMAP_H / bbH);
    return { worldBbox: { x: minX, y: minY, w: bbW, h: bbH }, scale: s };
  }, [deferredObjects, camera, viewportSize]);

  const toMini = (wx: number, wy: number) => ({
    x: (wx - worldBbox.x) * scale,
    y: (wy - worldBbox.y) * scale,
  });

  const vpRect = (() => {
    const tl = toMini(camera.x, camera.y);
    return {
      x: tl.x,
      y: tl.y,
      w: (viewportSize.w / camera.zoom) * scale,
      h: (viewportSize.h / camera.zoom) * scale,
    };
  })();

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!onPan) return;
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const worldX = mx / scale + worldBbox.x;
    const worldY = my / scale + worldBbox.y;
    onPan(worldX, worldY);
  };

  return (
    <div
      className="absolute right-3 bottom-14 z-10 select-none hidden sm:block"
      data-canvas-export-ignore="true"
    >
      <svg
        width={MINIMAP_W}
        height={MINIMAP_H}
        onMouseDown={handleClick}
        role="img"
        aria-label="Mini-map — click to pan the camera"
        style={{
          background: "rgba(11, 15, 23, 0.92)",
          border: "1px solid #2a2f3a",
          borderRadius: 6,
          backdropFilter: "blur(8px)",
          cursor: "pointer",
        }}
      >
        {deferredObjects.map((o) => {
          if (o.type === "connector" || o.type === "line" || o.type === "arrow") return null;
          // R11-fix: cull rects that project to <1.5 px on the mini-map.
          // These contribute no visible information but each is a
          // separate SVG node burning paint time. On a 1000-object
          // board at typical zoom, ~40% of objects fall below this
          // threshold.
          const w = o.w * scale;
          const h = o.h * scale;
          if (w < 1.5 && h < 1.5) return null;
          const tl = toMini(o.x, o.y);
          const color =
            o.type === "sticky" && "color" in o
              ? o.color
              : o.type === "frame"
                ? "rgba(148,163,184,0.25)"
                : "rgba(0,240,255,0.4)";
          return (
            <rect
              key={o.id}
              x={tl.x}
              y={tl.y}
              width={Math.max(1, w)}
              height={Math.max(1, h)}
              fill={color}
              rx={1}
            />
          );
        })}
        <rect
          x={vpRect.x}
          y={vpRect.y}
          width={vpRect.w}
          height={vpRect.h}
          fill="rgba(0, 240, 255, 0.06)"
          stroke="#00f0ff"
          strokeWidth={1.5}
        />
      </svg>
    </div>
  );
}

export const MiniMap = memo(MiniMapImpl);
