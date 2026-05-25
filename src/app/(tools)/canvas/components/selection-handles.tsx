"use client";

import { memo } from "react";
import { RotateCw } from "lucide-react";
import type { Camera, Rect } from "@/lib/geometry/bbox";
import type { ResizeHandle } from "../use-canvas-store";

const HANDLE_SIZE = 8;
// Touch-friendly hit area: the visual square stays 8 px (no UI regression
// on desktop) but the invisible touch surface expands to TOUCH_HIT_SIZE
// so a finger or stylus tip can land it without precision aiming.
const TOUCH_HIT_SIZE = 22;
const ROTATION_HANDLE_OFFSET = 24; // px above the top edge in screen space

interface SelectionHandlesProps {
  /** World-space union bbox of the selection. */
  bbox: Rect;
  camera: Camera;
  /** Hidden for multi-select to keep the math simple in PR 22B. */
  showResizeHandles: boolean;
  onHandlePointerDown: (handle: ResizeHandle, e: React.PointerEvent) => void;
  /** Called when the user presses on the rotation handle. Optional —
   * if omitted, the rotation handle isn't rendered. */
  onRotateStart?: (e: React.PointerEvent) => void;
  /** Current rotation in degrees of the primary selected object (or
   * the selection's effective angle for multi). Surfaced via
   * aria-valuenow so screen readers can announce the current angle. */
  currentRotationDeg?: number;
  /** Called with a delta angle in degrees when the user presses ←/→
   * with the rotation handle focused. Allows keyboard-only rotation. */
  onRotateByDelta?: (deltaDeg: number) => void;
  /** True on touch/stylus devices — expands the invisible hit area without
   * changing the visual handle size. */
  isCoarse?: boolean;
}

const HANDLES: { id: ResizeHandle; cursor: string; pos: (b: Rect) => { x: number; y: number } }[] =
  [
    { id: "nw", cursor: "nwse-resize", pos: (b) => ({ x: b.x, y: b.y }) },
    { id: "n", cursor: "ns-resize", pos: (b) => ({ x: b.x + b.w / 2, y: b.y }) },
    { id: "ne", cursor: "nesw-resize", pos: (b) => ({ x: b.x + b.w, y: b.y }) },
    { id: "e", cursor: "ew-resize", pos: (b) => ({ x: b.x + b.w, y: b.y + b.h / 2 }) },
    { id: "se", cursor: "nwse-resize", pos: (b) => ({ x: b.x + b.w, y: b.y + b.h }) },
    { id: "s", cursor: "ns-resize", pos: (b) => ({ x: b.x + b.w / 2, y: b.y + b.h }) },
    { id: "sw", cursor: "nesw-resize", pos: (b) => ({ x: b.x, y: b.y + b.h }) },
    { id: "w", cursor: "ew-resize", pos: (b) => ({ x: b.x, y: b.y + b.h / 2 }) },
  ];

function SelectionHandlesImpl({
  bbox,
  camera,
  showResizeHandles,
  onHandlePointerDown,
  onRotateStart,
  currentRotationDeg,
  onRotateByDelta,
  isCoarse,
}: SelectionHandlesProps) {
  // On touch devices we keep the 8 px visual but render a transparent
  // padded box around it so a finger can land the handle without
  // pixel-perfect aim. Hit-area scaling delta (one-sided extra pad).
  const hitPad = isCoarse ? Math.max(0, (TOUCH_HIT_SIZE - HANDLE_SIZE) / 2) : 0;
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
          // Wrapper carries the pointer event + the inflated hit area on
          // touch devices; the visible square is a centered child that
          // keeps the 8 px look. On desktop the wrapper IS the visual.
          const outerSize = HANDLE_SIZE + hitPad * 2;
          return (
            <div
              key={id}
              onPointerDown={(e) => {
                e.stopPropagation();
                onHandlePointerDown(id, e);
              }}
              // R11-fix: drop invalid `role="slider"`. WAI-ARIA requires
              // sliders to be focusable AND expose aria-valuenow/min/max.
              // Resize handles are decorative pointer-only affordances
              // (no keyboard support yet); the role announced a slider
              // that AT couldn't operate. The rotation handle below is
              // the only legitimate slider (focusable + keyboard + value).
              // Mark decorative so SR users aren't bounced through 8
              // un-actionable elements per selected object.
              role="presentation"
              aria-hidden="true"
              style={{
                position: "absolute",
                left: p.x - outerSize / 2,
                top: p.y - outerSize / 2,
                width: outerSize,
                height: outerSize,
                background: hitPad === 0 ? "#0b0f17" : "transparent",
                border: hitPad === 0 ? "1.5px solid #00f0ff" : "none",
                borderRadius: 2,
                cursor,
                zIndex: 10000,
                touchAction: "none",
                display: hitPad === 0 ? "block" : "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {hitPad > 0 && (
                <div
                  aria-hidden="true"
                  style={{
                    width: HANDLE_SIZE,
                    height: HANDLE_SIZE,
                    background: "#0b0f17",
                    border: "1.5px solid #00f0ff",
                    borderRadius: 2,
                    pointerEvents: "none",
                  }}
                />
              )}
            </div>
          );
        })}

      {/* Rotation handle — circle anchored ROTATION_HANDLE_OFFSET px
          above the top-centre. Press + drag to rotate every selected
          object around the union centre. Hold Shift during drag to
          snap to 15° increments.
          A11y: role="slider" + aria-valuenow/min/max so screen readers
          announce the current angle. Tab + ←/→/↑/↓ rotate via
          keyboard (Shift+arrow = ±15°). */}
      {showResizeHandles && onRotateStart && (
        <div
          tabIndex={0}
          onPointerDown={(e) => {
            e.stopPropagation();
            onRotateStart(e);
          }}
          onKeyDown={(e) => {
            if (!onRotateByDelta) return;
            const step = e.shiftKey ? 15 : 1;
            if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
              e.preventDefault();
              e.stopPropagation();
              onRotateByDelta(-step);
            } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
              e.preventDefault();
              e.stopPropagation();
              onRotateByDelta(step);
            }
          }}
          role="slider"
          aria-label="Rotate selection"
          aria-valuenow={Math.round(currentRotationDeg ?? 0)}
          aria-valuemin={-180}
          aria-valuemax={180}
          aria-valuetext={`${Math.round(currentRotationDeg ?? 0)} degrees`}
          style={{
            position: "absolute",
            // Visual rotation handle stays the same physical size; on touch
            // we inflate left/top/width/height with `hitPad * 2` extra to
            // grow the hit area transparently around it.
            left: x + w / 2 - (HANDLE_SIZE + 4) / 2 - hitPad,
            top: y - ROTATION_HANDLE_OFFSET - (HANDLE_SIZE + 4) / 2 - hitPad,
            width: HANDLE_SIZE + 4 + hitPad * 2,
            height: HANDLE_SIZE + 4 + hitPad * 2,
            background: hitPad === 0 ? "#0b0f17" : "transparent",
            border: hitPad === 0 ? "1.5px solid #00f0ff" : "none",
            borderRadius: "50%",
            cursor: "grab",
            zIndex: 10000,
            touchAction: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#00f0ff",
            // R11-fix: removed inline `outline: "none"`. Inline styles
            // win against the global `:focus-visible { outline: ... }`
            // rule, so Tab-focused keyboard users had no visible
            // indicator on the rotation handle (WCAG 2.4.7). The
            // browser's default focus ring is now allowed through.
          }}
        >
          {hitPad > 0 ? (
            <div
              aria-hidden="true"
              style={{
                width: HANDLE_SIZE + 4,
                height: HANDLE_SIZE + 4,
                background: "#0b0f17",
                border: "1.5px solid #00f0ff",
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "none",
              }}
            >
              <RotateCw style={{ width: 7, height: 7 }} aria-hidden="true" />
            </div>
          ) : (
            <RotateCw style={{ width: 7, height: 7 }} aria-hidden="true" />
          )}
        </div>
      )}
      {/* Tether line from rotation handle to top edge — pure visual cue. */}
      {showResizeHandles && onRotateStart && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: x + w / 2 - 0.5,
            top: y - ROTATION_HANDLE_OFFSET,
            width: 1,
            height: ROTATION_HANDLE_OFFSET,
            background: "#00f0ff",
            opacity: 0.4,
            pointerEvents: "none",
            zIndex: 9999,
          }}
        />
      )}
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
    prev.onHandlePointerDown === next.onHandlePointerDown &&
    prev.onRotateStart === next.onRotateStart &&
    prev.onRotateByDelta === next.onRotateByDelta &&
    prev.currentRotationDeg === next.currentRotationDeg &&
    prev.isCoarse === next.isCoarse
  );
});
