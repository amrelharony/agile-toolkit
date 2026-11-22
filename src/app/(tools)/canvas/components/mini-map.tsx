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
/** Its border. The page is border-box, so the map draws in the 198x138 inside it. */
const MINIMAP_BORDER = 1;

/**
 * Where the mini-map sits on a touch screen (the zoom stack it clears is
 * in zoom-controls.tsx).
 *
 * - On touch the zoom stack (Undo / Redo, full screen, the zoom bar) sits
 *   bottom-left. Its top is 4rem + 2px up from the board's bottom, and
 *   from sm up its right end is 26.875rem + 6px in from the left. On a
 *   board narrower than 28.125rem + 206px (656 px) the map's corner came
 *   down 10 px over that end. There the map rises 1rem + 2px, to 0.5rem
 *   above the stack. A margin's percentage is of the board's width, so
 *   the clamp is a step: the whole rise under 656 px, none from there up,
 *   where the map already clears the stack and stays where it was.
 * - The board toolbar (top-3) is the same 4rem + 2px tall, and a short
 *   landscape board has little room between the two. On touch the map is
 *   never taller than the board less both of them and a 0.5rem gap from
 *   each (9rem + 4px), and it keeps its shape as it shrinks
 *   (MINI_MAP_TOUCH_SIZE). So it never reaches the toolbar: at 640x360
 *   the board is 286 px tall inside, and the map 138 px, 8 px under it.
 *
 * With a mouse it stays right-3 bottom-14 at 200x140.
 */
export const MINI_MAP_TOUCH_PLACE =
  "pointer-coarse:mb-[clamp(0px,calc((28.125rem+206px-100%)*99),calc(1rem+2px))] pointer-coarse:h-[min(140px,calc(100%-9rem-4px))]";

/** On touch the map fills MINI_MAP_TOUCH_PLACE's height at its own 10:7 shape. */
export const MINI_MAP_TOUCH_SIZE =
  "pointer-coarse:h-full pointer-coarse:w-auto pointer-coarse:aspect-[10/7]";

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
    // A short touch board draws the map smaller (MINI_MAP_TOUCH_SIZE):
    // bring the press back to its 200x140 units. With a mouse this is 1.
    const k = rect.width > 0 ? MINIMAP_W / rect.width : 1;
    const mx = (e.clientX - rect.left) * k;
    const my = (e.clientY - rect.top) * k;
    const worldX = mx / scale + worldBbox.x;
    const worldY = my / scale + worldBbox.y;
    onPan(worldX, worldY);
  };

  return (
    <div
      className={`absolute right-3 bottom-14 z-10 select-none hidden sm:block ${MINI_MAP_TOUCH_PLACE}`}
      data-canvas-export-ignore="true"
    >
      <svg
        width={MINIMAP_W}
        height={MINIMAP_H}
        // The drawing area inside the border, so with a mouse one unit is
        // still one pixel; on touch the drawing scales with the map.
        viewBox={`0 0 ${MINIMAP_W - 2 * MINIMAP_BORDER} ${MINIMAP_H - 2 * MINIMAP_BORDER}`}
        className={MINI_MAP_TOUCH_SIZE}
        onMouseDown={handleClick}
        role="img"
        aria-label="Mini-map — click to pan the camera"
        style={{
          background: "rgba(11, 15, 23, 0.92)",
          border: `${MINIMAP_BORDER}px solid #2a2f3a`,
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
                : "color-mix(in srgb, var(--accent) 40%, transparent)";
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
          fill="color-mix(in srgb, var(--accent) 6%, transparent)"
          stroke="var(--accent)"
          strokeWidth={1.5}
        />
      </svg>
    </div>
  );
}

export const MiniMap = memo(MiniMapImpl);
