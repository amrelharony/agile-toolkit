"use client";

import { useEffect, useRef, type RefObject } from "react";
import { useGesture } from "@use-gesture/react";
import { panBy, zoomAt, fitToRects } from "@/lib/whiteboard/canvas-transform";
import type { Camera, Vec2 } from "@/lib/geometry/bbox";
import type { WhiteboardObject } from "@/lib/stores/workspace-types";

/**
 * Multi-touch gestures for the canvas viewport.
 *
 * Wires `@use-gesture/react` to the existing viewport ref so tablet users
 * get the gestures they expect:
 *
 *  - Pinch — zoom-to-pinch-centre, reusing `zoomAt` so the math matches
 *    the wheel-zoom code path exactly.
 *  - Two-finger drag — pan, reusing `panBy`. @use-gesture treats ANY
 *    two-finger contact as a pinch, so the pan lives inside `onPinch`
 *    (see `pinchCamera`): the pinch follows its centre as it moves.
 *    Single-finger drag is deliberately NOT consumed here: it stays
 *    available to the pointer machine for marquee / draw / drag-object.
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

/** Where a pinch began: the camera then and the pinch centre (viewport px). */
export interface PinchStart {
  camera: Camera;
  focal: Vec2;
}

/**
 * The camera for one pinch frame. Pans by how far the pinch centre has
 * moved since the gesture began, then zooms about where the centre is
 * now — so the board point that was under the fingers stays under them
 * while they spread AND while they slide together (two-finger pan).
 *
 * Derived from the gesture's START rather than applied as a per-event
 * delta to the live camera: the camera reaches React through a
 * rAF-throttled setter and both fingers' pointermoves land in the same
 * frame, so a delta added to the not-yet-updated camera would drop every
 * other step (the board would pan at about half the finger speed).
 */
export function pinchCamera(start: PinchStart, focal: Vec2, scale: number): Camera {
  const panned = panBy(start.camera, focal.x - start.focal.x, focal.y - start.focal.y);
  return zoomAt(panned, focal, start.camera.zoom * scale);
}

/**
 * Controls that sit on the board (the selection bar, buttons inside
 * widgets, text fields). A press on one is the control's, not a board
 * gesture: two quick taps on Duplicate must not also fit the board, and
 * holding a swatch must not open the actions menu.
 */
const BOARD_CONTROL_SELECTOR =
  'button, a[href], input, textarea, select, [contenteditable="true"], [role="toolbar"], [role="menu"]';

function isBoardControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(BOARD_CONTROL_SELECTOR) !== null;
}

/** The synthetic `contextmenu` events a touch long-press dispatched. */
const longPressEvents = new WeakSet<Event>();

/**
 * True for the `contextmenu` this hook dispatches for a touch long-press;
 * false for a mouse right-click, which keeps the browser's own menu (so
 * desktop behaviour is unchanged).
 */
export function isCanvasLongPress(e: Event): boolean {
  return longPressEvents.has(e);
}

/** Dispatch the long-press `contextmenu` on `target` at a screen point. */
export function dispatchCanvasLongPress(target: EventTarget, clientX: number, clientY: number) {
  const ev = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    button: 2,
  });
  longPressEvents.add(ev);
  target.dispatchEvent(ev);
}

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
        // `offset[0]` is the cumulative scale since the gesture started
        // (reset to 1 per gesture via `pinch.from` below — WITHOUT the
        // reset, @use-gesture carries offset across gestures, and
        // `startZoom * scale` re-applied the previous pinch's total on
        // the first event of every NEW pinch: zoom 2 jumped straight to
        // 4 the moment a second pinch registered). On the first event
        // we capture the starting camera and centre; every event then
        // derives the camera from that start — zoom by the per-gesture
        // factor, pan by how far the centre has travelled.
        const start: PinchStart =
          first || !memo ? { camera: cameraRef.current, focal } : (memo as PinchStart);
        throttledSetCamera(pinchCamera(start, focal, scale));
        return start;
      },
      // Fallback only: while two fingers are down @use-gesture reports
      // `pinching` and onPinch above does the pan. This branch runs only
      // if a two-finger drag ever arrives without an active pinch, so the
      // two never move the camera for the same event.
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
      // `from` resets the pinch offset to 1 at every gesture start so
      // `offset[0]` is the scale ratio of THIS pinch only. The library
      // default carries offset across gestures (and even across wheel
      // zooms in between), which both double-applied old pinches and —
      // once the cumulative offset hit scaleBounds.max — froze pinch
      // zoom entirely. scaleBounds now bounds the per-gesture ratio.
      pinch: {
        from: () => [1, 0] as [number, number],
        scaleBounds: { min: 0.1, max: 8 },
        rubberband: true,
      },
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
      if (isBoardControl(e.target)) {
        lastTap = null;
        return;
      }
      pressOrigin = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
      const pressTarget = e.target;
      longPressTimer = window.setTimeout(() => {
        // Dispatch a marked contextmenu at the touch position. It bubbles
        // to the viewport, where the board's long-press menu
        // (CanvasObjectMenu) opens for the selection the press made. Only
        // a target inside the board: anything else would never reach it.
        const hit =
          typeof document.elementFromPoint === "function"
            ? document.elementFromPoint(e.clientX, e.clientY)
            : null;
        const inBoard = (t: EventTarget | null): t is Node => t instanceof Node && el.contains(t);
        const target = inBoard(hit) ? hit : inBoard(pressTarget) ? pressTarget : el;
        dispatchCanvasLongPress(target, e.clientX, e.clientY);
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
  // dispatches its own marked contextmenu at the right position.
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
