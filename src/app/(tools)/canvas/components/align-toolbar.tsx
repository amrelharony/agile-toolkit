"use client";

/**
 * Floating align/distribute toolbar.
 *
 * Renders just above the selection bbox (in screen space) whenever
 * 2+ objects are selected. Hidden on single-select (no align math
 * possible) and on resize/drag in progress (avoid UI thrash).
 *
 * Six align buttons + 2 distribute buttons. Distribute only enables
 * with 3+ objects (with 2, distribute is identical to align).
 *
 * Mirrors Miro/Figma conventions:
 *   - Align targets = union bbox of the selection
 *   - Distribute = equal gap between adjacent rects, anchors at ends
 */

import { memo } from "react";
import {
  AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter,
} from "lucide-react";
import type { Camera, Rect } from "@/lib/geometry/bbox";
import type { AlignOp, DistributeOp } from "@/lib/whiteboard/align";

interface AlignToolbarProps {
  /** Union bbox of the current selection, in WORLD coords. The toolbar
   * floats just above it after projecting through the camera. */
  selectionBbox: Rect;
  camera: Camera;
  /** Set to false to hide distribute buttons (selection < 3). */
  canDistribute: boolean;
  onAlign: (op: AlignOp) => void;
  onDistribute: (op: DistributeOp) => void;
}

const BTN = "w-7 h-7 rounded flex items-center justify-center text-sub hover:text-text hover:bg-surface-deep transition-colors";

function AlignToolbarImpl({ selectionBbox, camera, canDistribute, onAlign, onDistribute }: AlignToolbarProps) {
  // Anchor BELOW the selection bbox (12 px gap) so the property panel
  // can claim the above-the-bbox slot uncontested. Both panels are
  // visible simultaneously on a multi-select, so keeping them on
  // opposite sides avoids overlap.
  const screenX = (selectionBbox.x - camera.x) * camera.zoom;
  const screenY = (selectionBbox.y - camera.y) * camera.zoom;
  const screenW = selectionBbox.w * camera.zoom;
  const screenH = selectionBbox.h * camera.zoom;
  const left = screenX + screenW / 2;
  const top = screenY + screenH + 12;

  return (
    <div
      role="toolbar"
      aria-label="Align and distribute"
      data-canvas-export-ignore="true"
      style={{
        position: "absolute",
        left,
        top,
        transform: "translateX(-50%)",
        zIndex: 9997,
      }}
      className="flex items-center gap-0.5 bg-surface/95 border border-border rounded-lg px-1 py-1 shadow-lg backdrop-blur-sm"
    >
      <button type="button" className={BTN} aria-label="Align left" title="Align left"
        onClick={() => onAlign("align-left")}>
        <AlignStartVertical className="w-4 h-4" aria-hidden="true" />
      </button>
      <button type="button" className={BTN} aria-label="Align center horizontally" title="Align center (X)"
        onClick={() => onAlign("align-center-x")}>
        <AlignCenterVertical className="w-4 h-4" aria-hidden="true" />
      </button>
      <button type="button" className={BTN} aria-label="Align right" title="Align right"
        onClick={() => onAlign("align-right")}>
        <AlignEndVertical className="w-4 h-4" aria-hidden="true" />
      </button>
      <div className="w-px h-4 bg-border mx-0.5" />
      <button type="button" className={BTN} aria-label="Align top" title="Align top"
        onClick={() => onAlign("align-top")}>
        <AlignStartHorizontal className="w-4 h-4" aria-hidden="true" />
      </button>
      <button type="button" className={BTN} aria-label="Align center vertically" title="Align center (Y)"
        onClick={() => onAlign("align-center-y")}>
        <AlignCenterHorizontal className="w-4 h-4" aria-hidden="true" />
      </button>
      <button type="button" className={BTN} aria-label="Align bottom" title="Align bottom"
        onClick={() => onAlign("align-bottom")}>
        <AlignEndHorizontal className="w-4 h-4" aria-hidden="true" />
      </button>
      {canDistribute && (
        <>
          <div className="w-px h-4 bg-border mx-0.5" />
          <button type="button" className={BTN} aria-label="Distribute horizontally" title="Distribute horizontally"
            onClick={() => onDistribute("distribute-h")}>
            <AlignHorizontalDistributeCenter className="w-4 h-4" aria-hidden="true" />
          </button>
          <button type="button" className={BTN} aria-label="Distribute vertically" title="Distribute vertically"
            onClick={() => onDistribute("distribute-v")}>
            <AlignVerticalDistributeCenter className="w-4 h-4" aria-hidden="true" />
          </button>
        </>
      )}
    </div>
  );
}

export const AlignToolbar = memo(AlignToolbarImpl);
