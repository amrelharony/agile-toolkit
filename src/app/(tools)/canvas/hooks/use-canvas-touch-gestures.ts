"use client";

import { useEffect, useRef, type RefObject } from "react";
import { useGesture } from "@use-gesture/react";
import { panBy, zoomAt, fitToRects } from "@/lib/whiteboard/canvas-transform";
import type { Camera } from "@/lib/geometry/bbox";
import type { WhiteboardObject } from "@/lib/stores/workspace-types";

/**
 * Multi-touch gestures for the canvas viewport.
 *
 * Wires `@use-gesture/react` to the existing viewport ref so tablet users
 * get the gestures they expect:
 *
 *  - Pinch — zoom-to-pinch-centre, reusing `zoomAt` so the math matches
 *    the wheel-zoom code path exactly.
 *  - Two-finger drag — pan, reusing `panBy`. Single-finger drag is
 *    deliberately NOT consumed here: it stays available to the pointer
 *    machine for marquee / draw / drag-object.
 *
 * Double-tap and long-press are NOT routed through @use-gesture/react —
 * its `onDoubleClick` registers an `addEventListener("doubleclick", ...)`
 * listener (the real DOM event is `dblclick`), so the handler never
 * fires. Likewise its `onContextMenu` is unreliable on Android Chrome
 * when `touch-action: none` is set. Both are implemented as manual
 * pointer-based timers inside this hook.
 *
 * Mouse and pen events are not consumed by the gesture recognizers:
 * every callback bails when `event.pointerType !== "touch"`. Pinch + pan
 * are also gated on `anyPenActive === 0` so accidental palm touches
 * during stylus inking don't zoom / pan the board.
 *
 * `eventOptions: { passive: false }` is required so the recognizers can
 * preventDefault and stop the OS from scrolling / page-pinching the
 * canvas page (the per-route viewport.ts also disables OS pinch).
 */
const DOUBLE_TAP_MS = 300; // max gap between two taps to count as double
const DOUBLE_TAP_PX = 24; // max screen-space distance between two taps
const LONG_PRESS_MS = 500; // hold time to trigger long-press menu
const LONG_PRESS_SLOP_PX = 8; // finger movement that cancels a long-press

export function useCanvasTouchGestures(params: {
  viewportRef: RefObject<HTMLDivElement | null>;
  viewportRectRef: RefObject<DOMRect | null>;
  camera: Camera;
  throttledSetCamera: (c: Camera) => void;
  setCamera: (c: Camera) => void;
  objects: readonly WhiteboardObject[];
  viewportSize: { w: number; h: number };
  presentationFrameIndex: number | null;
  /** Set of pointerIds of pens in contact. Pinch / pan are suppressed
   * while non-empty so palm touches during inking don't navigate. */
  anyPenActiveRef: React.MutableRefObject<Set<number>>;
}) {
  const {
    viewportRef,
    viewportRectRef,
    camera,
    throttledSetCamera,
    setCamera,
    objects,
    viewportSize,
    presentationFrameIndex,
    anyPenActiveRef,
  } = params;

  // Camera + objects in refs so the gesture handlers (which `useGesture`
  // memoises) always read the latest value without re-binding on every
  // camera tick.
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const objectsRef = useRef(objects);
  objectsRef.current = objects;
  const sizeRef = useRef(viewportSize);
  sizeRef.current = viewportSize;
  const presentationRef = useRef(presentationFrameIndex);
  presentationRef.current = presentationFrameIndex;

  useGesture(
    {
      onPinch: ({ origin, offset: [scale], event, first, memo }) => {
        if (presentationRef.current !== null) return memo;
        if (anyPenActiveRef.current.size > 0) return memo;
        const pt = (event as PointerEvent)?.pointerType;
        if (pt && pt !== "touch") return memo;
        const rect = viewportRectRef.current;
        if (!rect) return memo;
        const focal = {
          x: origin[0] - rect.left,
          y: origin[1] - rect.top,
        };
        // `offset[0]` from `@use-gesture/react` is the cumulative scale
        // since the gesture started (initialised to 1, multiplicatively
        // accumulated per event). On the first event we capture the
        // starting zoom; subsequent events apply the cumulative factor.
        const startZoom = first
          ? cameraRef.current.zoom
          : (memo?.startZoom ?? cameraRef.current.zoom);
        throttledSetCamera(zoomAt(cameraRef.current, focal, startZoom * scale));
        return { startZoom };
      },
      onDrag: ({ delta: [dx, dy], touches, event, pinching }) => {
        if (presentationRef.current !== null) return;
        if (pinching) return;
        if (anyPenActiveRef.current.size > 0) return;
        const pt = (event as PointerEvent)?.pointerType;
        if (pt && pt !== "touch") return;
        if (touches !== 2) return;
        throttledSetCamera(panBy(cameraRef.current, dx, dy));
      },
    },
    {
      target: viewportRef as unknown as RefObject<EventTarget>,
      eventOptions: { passive: false },
      pinch: { scaleBounds: { min: 0.1, max: 8 }, rubberband: true },
      drag: { filterTaps: true, threshold: 4 },
    }
  );

  // Manual double-tap + long-press detection. We can't use
  // @use-gesture/react for either: its `onDoubleClick` registers for the
  // non-existent `"doubleclick"` event, and Android Chrome with
  // `touch-action: none` suppresses the native `contextmenu` long-press
  // synthesis. So we listen for pointerdown / pointerup directly and
  // measure timings here.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    let lastTap: { x: number; y: number; t: number } | null = null;
    let longPressTimer: number | null = null;
    let pressOrigin: { x: number; y: number; pointerId: number } | null = null;

    const clearLongPress = () => {
      if (longPressTimer !== null) {
        window.clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      pressOrigin = null;
    };

    const fireFitToContent = () => {
      if (presentationRef.current !== null) return;
      const objs = objectsRef.current;
      const size = sizeRef.current;
      if (objs.length === 0 || size.w === 0) {
        setCamera({ x: 0, y: 0, zoom: 1 });
        return;
      }
      const rects = objs.map((o) => ({ x: o.x, y: o.y, w: o.w, h: o.h }));
      const fitted = fitToRects(rects, size.w, size.h, 0.1);
      if (fitted) setCamera(fitted);
    };

    const onDown = (e: PointerEvent) => {
      // Touch only — pen and mouse have their own dedicated paths
      // (pen draws; mouse right-clicks for context menu).
      if (e.pointerType !== "touch") return;
      // Don't compete with pinch / pan: if another touch is already
      // down, abort any pending long-press and reset double-tap.
      if (pressOrigin) {
        clearLongPress();
        lastTap = null;
        return;
      }
      pressOrigin = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
      longPressTimer = window.setTimeout(() => {
        // Dispatch a synthetic contextmenu MouseEvent at the touch
        // position so the existing right-click handlers on objects fire.
        // React's delegated event system catches the bubbled event.
        const target = document.elementFromPoint(e.clientX, e.clientY);
        if (target) {
          target.dispatchEvent(
            new MouseEvent("contextmenu", {
              bubbles: true,
              cancelable: true,
              clientX: e.clientX,
              clientY: e.clientY,
              button: 2,
            })
          );
        }
        clearLongPress();
        lastTap = null;
      }, LONG_PRESS_MS);
    };

    const onMove = (e: PointerEvent) => {
      if (!pressOrigin || e.pointerId !== pressOrigin.pointerId) return;
      const dx = e.clientX - pressOrigin.x;
      const dy = e.clientY - pressOrigin.y;
      if (Math.hypot(dx, dy) > LONG_PRESS_SLOP_PX) {
        // Finger drifted — not a long-press; also disqualifies the
        // touch as a tap for double-tap purposes.
        clearLongPress();
        lastTap = null;
      }
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      // pressOrigin is non-null only when we're still tracking this
      // touch as a potential tap. If the long-press timer already fired,
      // its callback set pressOrigin to null, so this early-returns and
      // no tap is registered — that's intentional.
      if (!pressOrigin || e.pointerId !== pressOrigin.pointerId) return;
      const origin = pressOrigin;
      clearLongPress();
      // Only register a tap if we never moved past the slop threshold.
      const dx = e.clientX - origin.x;
      const dy = e.clientY - origin.y;
      if (Math.hypot(dx, dy) > LONG_PRESS_SLOP_PX) {
        lastTap = null;
        return;
      }
      const now = performance.now();
      if (lastTap && now - lastTap.t <= DOUBLE_TAP_MS) {
        const ddx = e.clientX - lastTap.x;
        const ddy = e.clientY - lastTap.y;
        if (Math.hypot(ddx, ddy) <= DOUBLE_TAP_PX) {
          fireFitToContent();
          lastTap = null;
          return;
        }
      }
      lastTap = { x: e.clientX, y: e.clientY, t: now };
    };

    const onCancel = () => {
      clearLongPress();
      lastTap = null;
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onCancel);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onCancel);
      clearLongPress();
    };
  }, [viewportRef, setCamera]);

  // Belt-and-braces: even with `touch-action: none` on the viewport,
  // browsers vary on whether they suppress the system context-menu
  // (long-press) by default. Force it off — our manual long-press
  // synthesises the right contextmenu event at the right position.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const block = (e: MouseEvent) => {
      // Touch-originated contextmenu (the OS long-press) — suppress so
      // the browser's text-selection menu doesn't fight our flow.
      // Right-click from mouse still bubbles normally.
      // The PointerEvent that triggered may not be available here, so
      // distinguish by `e.button === 0` (touch-originated contextmenu)
      // vs `e.button === 2` (right-click).
      if (e.button === 0) e.preventDefault();
    };
    el.addEventListener("contextmenu", block);
    return () => el.removeEventListener("contextmenu", block);
  }, [viewportRef]);
}
