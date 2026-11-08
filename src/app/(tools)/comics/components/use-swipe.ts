"use client";

import { useRef } from "react";
import type { TouchEvent } from "react";

/** How far a finger has to travel sideways, in CSS px, before it counts. */
export const SWIPE_MIN_PX = 48;

/** -1 back, 1 on. */
export type SwipeStep = -1 | 1;

/** Which ways a swipe that starts now may go. */
export interface SwipeEdges {
  back: boolean;
  on: boolean;
}

/** Above this the page is pinch-zoomed, and a finger is panning it, not swiping. */
const ZOOMED = 1.01;

function pageScale(): number {
  try {
    return window.visualViewport?.scale ?? 1;
  } catch {
    return 1;
  }
}

/**
 * What a finished one-finger gesture asks for: on (1) for a swipe to the left,
 * back (-1) for one to the right, or nothing. It has to be mostly sideways, far
 * enough, and on a page at its own size: zoomed in, the browser's pinch owns the
 * finger.
 */
export function swipeStep(
  { dx, dy, scale }: { dx: number; dy: number; scale: number },
  min = SWIPE_MIN_PX
): SwipeStep | 0 {
  if (scale > ZOOMED) return 0;
  if (Math.abs(dx) < min || Math.abs(dx) < Math.abs(dy) * 2) return 0;
  return dx < 0 ? 1 : -1;
}

/**
 * Touch handlers for swiping between items. Touch events, not pointer events:
 * the element keeps the browser's own pan and pinch (touch-action), and the
 * browser cancels a pointer stream as soon as it takes a gesture over, while
 * touch events keep coming. A second finger means a pinch, so the gesture is
 * dropped. `edges`, read as the finger lands, lets a scroller pan to its own
 * edge before a swipe moves on, and never both in one gesture.
 */
export function useSwipe(onStep: (step: SwipeStep) => void, edges?: () => SwipeEdges) {
  const start = useRef<{ x: number; y: number; allowed: SwipeEdges } | null>(null);

  const onTouchStart = (e: TouchEvent) => {
    const touch = e.touches[0];
    if (e.touches.length !== 1 || !touch || pageScale() > ZOOMED) {
      start.current = null;
      return;
    }
    start.current = {
      x: touch.clientX,
      y: touch.clientY,
      allowed: edges?.() ?? { back: true, on: true },
    };
  };

  const onTouchEnd = (e: TouchEvent) => {
    const from = start.current;
    start.current = null;
    const touch = e.changedTouches[0];
    if (!from || !touch) return;
    const step = swipeStep({
      dx: touch.clientX - from.x,
      dy: touch.clientY - from.y,
      scale: pageScale(),
    });
    if (step === 1 && from.allowed.on) onStep(1);
    else if (step === -1 && from.allowed.back) onStep(-1);
  };

  const onTouchCancel = () => {
    start.current = null;
  };

  return { onTouchStart, onTouchEnd, onTouchCancel };
}
