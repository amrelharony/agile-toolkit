"use client";

import { useEffect, useRef, useState } from "react";
import { ZOOM_EPSILON, zoomStep } from "@/lib/comic/reader-math";

/** Minimum horizontal travel for a page turn. */
const MIN_SWIPE_PX = 50;
/** Vertical drift allowed per px of horizontal travel ("mostly horizontal"). */
const MAX_SLOPE = 0.5;
/** How long after a swipe the synthetic click is ignored. */
const CLICK_SUPPRESS_MS = 400;
/** How long a pinch must rest before pages re-render for its zoom. */
const ZOOM_SETTLE_MS = 250;

/**
 * True while the page is pinch-zoomed. Swipes and tap zones turn off then,
 * so panning around a zoomed panel never flips the page.
 */
export function useIsZoomed(): boolean {
  const [zoomed, setZoomed] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () => setZoomed(vv.scale > ZOOM_EPSILON);
    sync();
    vv.addEventListener("resize", sync);
    return () => vv.removeEventListener("resize", sync);
  }, []);
  return zoomed;
}

/**
 * The pinch-zoom factor to render pages for (`zoomStep` of
 * visualViewport.scale), updated once the zoom has rested for a moment:
 * following every frame of a pinch would queue renders the next frame
 * makes stale. 1 when not zoomed or without visualViewport.
 */
export function useSettledZoom(): number {
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setZoom(zoomStep(vv.scale)), ZOOM_SETTLE_MS);
    };
    setZoom(zoomStep(vv.scale));
    vv.addEventListener("resize", settle);
    return () => {
      clearTimeout(timer);
      vv.removeEventListener("resize", settle);
    };
  }, []);
  return zoom;
}

export interface PageSwipeOptions {
  /** Finger moved right-to-left. */
  onSwipeLeft: () => void;
  /** Finger moved left-to-right. */
  onSwipeRight: () => void;
  enabled: boolean;
}

/**
 * Horizontal swipe → page turn on touch and pen input.
 *
 * Deliberately not useSwipeToClose: that hook treats `pointercancel` as a
 * release and ignores extra fingers. Here the stage uses
 * `touch-action: pan-y pinch-zoom`, so the browser cancels the pointer
 * whenever it takes over a vertical scroll or a pinch — a cancel must never
 * turn the page, and neither may the first finger of a pinch.
 *
 * Returns `recentlySwiped()` so tap zones can ignore the click some
 * browsers still fire at the end of a swipe.
 */
export function usePageSwipe(
  el: HTMLElement | null,
  { onSwipeLeft, onSwipeRight, enabled }: PageSwipeOptions
): { recentlySwiped: () => boolean } {
  const handlersRef = useRef({ onSwipeLeft, onSwipeRight });
  handlersRef.current = { onSwipeLeft, onSwipeRight };
  const lastSwipeAtRef = useRef(0);
  const recentlySwipedRef = useRef(
    () => performance.now() - lastSwipeAtRef.current < CLICK_SUPPRESS_MS
  );

  useEffect(() => {
    if (!el || !enabled) return;
    const down = new Set<number>();
    let start: { id: number; x: number; y: number } | null = null;

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      down.add(e.pointerId);
      // A second finger means pinch or a two-finger scroll: abandon the
      // gesture until every finger has lifted.
      start = down.size === 1 ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null;
    };
    const onUp = (e: PointerEvent) => {
      if (!down.delete(e.pointerId)) return;
      const s = start;
      if (!s || s.id !== e.pointerId) return;
      start = null;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.abs(dx) < MIN_SWIPE_PX || Math.abs(dy) > Math.abs(dx) * MAX_SLOPE) return;
      lastSwipeAtRef.current = performance.now();
      if (dx < 0) handlersRef.current.onSwipeLeft();
      else handlersRef.current.onSwipeRight();
    };
    const onCancel = (e: PointerEvent) => {
      down.delete(e.pointerId);
      if (start?.id === e.pointerId) start = null;
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onCancel);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onCancel);
    };
  }, [el, enabled]);

  return { recentlySwiped: recentlySwipedRef.current };
}
