"use client";

import { useEffect, type RefObject } from "react";

/**
 * Keeps a pinch that starts on the board out of the browser's page zoom.
 *
 * /canvas no longer locks zoom for the whole page (WCAG 1.4.4), so the
 * board has to claim its own pinch. Its viewport is `touch-action: none`,
 * which is enough in Chrome and Firefox. Safari has its own pinch events
 * (`gesturestart` / `gesturechange`) and has been patchy about
 * `touch-action` for zoom, so this also cancels those, and any two-finger
 * `touchmove`, on the board only. Pointer events still reach the board's
 * pinch / two-finger pan (use-canvas-touch-gestures): cancelling a touch
 * event doesn't cancel the pointer events it came with. One finger is
 * left alone (drawing, dragging, marquee are pointer-driven anyway), and
 * everything outside the board can still pinch-zoom the page.
 */
export function useBoardPinchGuard(boardRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const cancel = (e: Event) => {
      if (e.cancelable) e.preventDefault();
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length >= 2) cancel(e);
    };
    // Non-passive, or preventDefault would be ignored.
    const opts: AddEventListenerOptions = { passive: false };
    el.addEventListener("touchmove", onTouchMove, opts);
    el.addEventListener("gesturestart", cancel, opts);
    el.addEventListener("gesturechange", cancel, opts);
    return () => {
      el.removeEventListener("touchmove", onTouchMove, opts);
      el.removeEventListener("gesturestart", cancel, opts);
      el.removeEventListener("gesturechange", cancel, opts);
    };
  }, [boardRef]);
}
