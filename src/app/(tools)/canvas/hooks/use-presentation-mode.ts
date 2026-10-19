"use client";

import { useEffect } from "react";
import { fitToRects } from "@/lib/whiteboard/canvas-transform";
import { controlOwnsKey } from "@/lib/whiteboard/keyboard";
import type { Camera } from "@/lib/geometry/bbox";

type FrameLike = { x: number; y: number; w: number; h: number };

/**
 * Drives presentation-mode frame walkthrough.
 *
 * Two effects bundled together because they share a "presenting?"
 * trigger and would otherwise live as a coordinated pair in the
 * parent component:
 *
 *  1. **Fit-to-frame** — whenever `presentationFrameIndex` changes,
 *     fit the camera to the corresponding frame with a 15 % margin.
 *     Bails out before the viewport size is known to avoid a
 *     zero-size fit.
 *
 *  2. **Keyboard navigation** — while `presentationFrameIndex !== null`,
 *     window-level ArrowRight/Space advance, ArrowLeft backs up, Esc
 *     exits. The handler stops propagation so the canvas's own
 *     keyboard shortcuts (nudge / cancel) don't fire in parallel.
 *
 * Inputs typed by minimal shapes (the frame just needs x/y/w/h) so
 * this hook stays decoupled from the WhiteboardObject union.
 */
export function usePresentationMode(params: {
  presentationFrameIndex: number | null;
  orderedFrames: readonly FrameLike[];
  size: { w: number; h: number };
  setCamera: (cam: Camera) => void;
  setPresentationFrameIndex: (i: number | null) => void;
}) {
  const { presentationFrameIndex, orderedFrames, size, setCamera, setPresentationFrameIndex } =
    params;

  // Whenever presentationFrameIndex changes, fit the camera to that frame.
  useEffect(() => {
    if (presentationFrameIndex === null) return;
    if (size.w === 0) return;
    const frame = orderedFrames[presentationFrameIndex];
    if (!frame) return;
    const cam = fitToRects(
      [{ x: frame.x, y: frame.y, w: frame.w, h: frame.h }],
      size.w,
      size.h,
      0.15
    );
    if (cam) setCamera(cam);
  }, [presentationFrameIndex, orderedFrames, size.w, size.h, setCamera]);

  // Arrow-key navigation while presenting (and Esc to exit). Window-
  // level so focus doesn't matter.
  useEffect(() => {
    if (presentationFrameIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      // Space on a focused button (Exit, Previous…) must press that
      // button, not advance the slide (WCAG 2.1.1).
      if (e.key === " " && controlOwnsKey(t, e.key)) return;
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        // Stop the canvas-level keyboard handler from also handling
        // these keys — without this, ArrowRight nudged the current
        // selection AS the presentation cycled to the next frame, and
        // Esc cleared selection on the underlying canvas as it exited
        // presentation. Both handlers register on `window` so capture
        // order is registration order; we stop propagation defensively.
        e.stopPropagation();
        setPresentationFrameIndex(Math.min(orderedFrames.length - 1, presentationFrameIndex + 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        setPresentationFrameIndex(Math.max(0, presentationFrameIndex - 1));
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setPresentationFrameIndex(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presentationFrameIndex, orderedFrames.length, setPresentationFrameIndex]);
}
