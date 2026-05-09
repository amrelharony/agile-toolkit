"use client";

import { useEffect, type RefObject } from "react";

interface Options {
  /** Direction the swipe should travel to trigger close. */
  direction?: "left" | "right" | "down" | "up";
  /** Distance (px) the pointer must travel to trigger close. */
  threshold?: number;
  /** Minimum velocity (px/ms) to fast-dismiss below threshold. */
  velocityThreshold?: number;
  /** Disables the hook without unmounting it (e.g., when drawer is closed). */
  enabled?: boolean;
  onClose: () => void;
}

/**
 * Lightweight swipe-to-close for drawers and sheets.  Attaches pointer listeners
 * to the target element; resolves to `onClose()` when the gesture crosses the
 * distance or velocity threshold in the configured direction.
 */
export function useSwipeToClose(
  ref: RefObject<HTMLElement | null>,
  { direction = "left", threshold = 60, velocityThreshold = 0.3, enabled = true, onClose }: Options,
) {
  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;

    let startX = 0;
    let startY = 0;
    let startT = 0;
    let tracking = false;

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return; // drawers already have backdrop on desktop
      startX = e.clientX;
      startY = e.clientY;
      startT = e.timeStamp;
      tracking = true;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!tracking) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      // Cancel vertical scrolls so we don't hijack the drawer's own scroll
      if (direction === "left" || direction === "right") {
        if (Math.abs(dy) > Math.abs(dx) + 8) tracking = false;
      } else {
        if (Math.abs(dx) > Math.abs(dy) + 8) tracking = false;
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!tracking) return;
      tracking = false;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const dt = Math.max(1, e.timeStamp - startT);

      let travel = 0;
      let velocity = 0;
      if (direction === "left") {
        travel = -dx;
        velocity = -dx / dt;
      } else if (direction === "right") {
        travel = dx;
        velocity = dx / dt;
      } else if (direction === "up") {
        travel = -dy;
        velocity = -dy / dt;
      } else {
        travel = dy;
        velocity = dy / dt;
      }

      if (travel > threshold || velocity > velocityThreshold) onClose();
    };

    el.addEventListener("pointerdown", onPointerDown, { passive: true });
    el.addEventListener("pointermove", onPointerMove, { passive: true });
    el.addEventListener("pointerup", onPointerUp, { passive: true });
    el.addEventListener("pointercancel", onPointerUp, { passive: true });
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
    };
  }, [ref, direction, threshold, velocityThreshold, enabled, onClose]);
}
