"use client";

import { memo } from "react";
import type { Camera, Rect } from "@/lib/geometry/bbox";
import type { ResizeHandle } from "../use-canvas-store";

const HANDLE_SIZE = 8;

interface SelectionHandlesProps {
  /** World-space union bbox of the selection. */
  bbox: Rect;
  camera: Camera;
  /** Hidden for multi-select to keep the math simple in PR 22B. */
  showResizeHandles: boolean;
  onHandlePointerDown: (handle: ResizeHandle, e: React.PointerEvent) => void;
}

const HANDLES: { id: ResizeHandle; cursor: string; pos: (b: Rect) => { x: number; y: number } }[] = [
  { id: "nw", cursor: "nwse-resize", pos: (b) => ({ x: b.x,             y: b.y }) },
  { id: "n",  cursor: "ns-resize",   pos: (b) => ({ x: b.x + b.w / 2,   y: b.y }) },
  { id: "ne", cursor: "nesw-resize", pos: (b) => ({ x: b.x + b.w,       y: b.y }) },
  { id: "e",  cursor: "ew-resize",   pos: (b) => ({ x: b.x + b.w,       y: b.y + b.h / 2 }) },
  { id: "se", cursor: "nwse-resize", pos: (b) => ({ x: b.x + b.w,       y: b.y + b.h }) },
  { id: "s",  cursor: "ns-resize",   pos: (b) => ({ x: b.x + b.w / 2,   y: b.y + b.h }) },
  { id: "sw", cursor: "nesw-resize", pos: (b) => ({ x: b.x,             y: b.y + b.h }) },
  { id: "w",  cursor: "ew-resize",   pos: (b) => ({ x: b.x,             y: b.y + b.h / 2 }) },
];

function SelectionHandlesImpl({ bbox, camera, showResizeHandles, onHandlePointerDown }: SelectionHandlesProps) {
  // Outline rendered in screen space so border thickness is 1px at every zoom.
  const x = (bbox.x - camera.x) * camera.zoom;
  const y = (bbox.y - camera.y) * camera.zoom;
  const w = bbox.w * camera.zoom;
  const h = bbox.h * camera.zoom;
  return (
    <>
      <div
        aria-hidden="true"
        data-canvas-export-ignore="true"
        style={{
          position: "absolute",
          left: x - 1,
          top: y - 1,
          width: w + 2,
          height: h + 2,
          border: "1px solid #00f0ff",
          pointerEvents: "none",
          zIndex: 9998,
          boxShadow: "0 0 0 1px rgba(0, 0, 0, 0.4)",
        }}
      />
      {showResizeHandles &&
        HANDLES.map(({ id, cursor, pos }) => {
          const p = pos({ x, y, w, h });
          return (
            <div
              key={id}
              onPointerDown={(e) => {
                e.stopPropagation();
                onHandlePointerDown(id, e);
              }}
              role="slider"
              aria-label={`Resize handle ${id}`}
              style={{
                position: "absolute",
                left: p.x - HANDLE_SIZE / 2,
                top: p.y - HANDLE_SIZE / 2,
                width: HANDLE_SIZE,
                height: HANDLE_SIZE,
                background: "#0b0f17",
                border: "1.5px solid #00f0ff",
                borderRadius: 2,
                cursor,
                zIndex: 10000,
                touchAction: "none",
              }}
            />
          );
        })}
    </>
  );
}

/**
 * memo() keeps re-renders cheap during drag. Without it, every pointer
 * move that bumps the parent's drag state would also re-render the
 * 8-handle subtree (60+ times/sec). The parent passes a fresh bbox
 * object literal each render so we rely on React's default shallow
 * compare to skip when none of the primitive fields changed.
 */
export const SelectionHandles = memo(SelectionHandlesImpl, (prev, next) => {
  return (
    prev.bbox.x === next.bbox.x &&
    prev.bbox.y === next.bbox.y &&
    prev.bbox.w === next.bbox.w &&
    prev.bbox.h === next.bbox.h &&
    prev.camera.x === next.camera.x &&
    prev.camera.y === next.camera.y &&
    prev.camera.zoom === next.camera.zoom &&
    prev.showResizeHandles === next.showResizeHandles &&
    prev.onHandlePointerDown === next.onHandlePointerDown
  );
});
