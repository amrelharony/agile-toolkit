"use client";

import { useEffect, useMemo, useRef, type RefObject, type MutableRefObject } from "react";
import { fitToRects, resetCamera, zoomAt } from "@/lib/whiteboard/canvas-transform";
import { controlOwnsKey, isInsideScope } from "@/lib/whiteboard/keyboard";
import type { Camera } from "@/lib/geometry/bbox";

/** Zoom factor of one zoom-in / zoom-out step (buttons and shortcuts). */
export const ZOOM_STEP = 1.2;

/** One zoom step about the viewport centre — shared by the ZoomControls
 *  buttons and the Cmd/Ctrl + = / - shortcuts so both move identically. */
export function zoomStep(
  camera: Camera,
  size: { w: number; h: number },
  direction: 1 | -1
): Camera {
  const factor = direction > 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
  return zoomAt(camera, { x: size.w / 2, y: size.h / 2 }, camera.zoom * factor);
}

export interface KeyboardZoomActions {
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  fitToContent: () => void;
}

/**
 * Camera moves behind the zoom shortcuts the ZoomControls tooltips
 * advertise (Cmd/Ctrl + = / - / 0 / 1). The keys used to be bound with
 * no handler, so they did nothing on the board and still swallowed the
 * browser's own page zoom. The returned object is stable — camera and
 * size are read from refs at call time — so the shortcut listener
 * doesn't rebind on every camera tick.
 */
export function useKeyboardZoomActions(params: {
  camera: Camera;
  setCamera: (cam: Camera) => void;
  size: { w: number; h: number };
  objectsRef: RefObject<readonly { x: number; y: number; w: number; h: number }[]>;
}): KeyboardZoomActions {
  const { camera, setCamera, size, objectsRef } = params;
  const cameraRef = useRef(camera);
  const sizeRef = useRef(size);
  useEffect(() => {
    cameraRef.current = camera;
    sizeRef.current = size;
  }, [camera, size]);
  return useMemo(
    () => ({
      zoomIn: () => setCamera(zoomStep(cameraRef.current, sizeRef.current, 1)),
      zoomOut: () => setCamera(zoomStep(cameraRef.current, sizeRef.current, -1)),
      resetZoom: () => setCamera(resetCamera()),
      // Same fit as the "Fit to content" buttons (10% margin).
      fitToContent: () => {
        const rects = (objectsRef.current ?? []).map((o) => ({ x: o.x, y: o.y, w: o.w, h: o.h }));
        const { w, h } = sizeRef.current;
        const cam = fitToRects(rects, w, h, 0.1);
        if (cam) setCamera(cam);
      },
    }),
    [setCamera, objectsRef]
  );
}

/**
 * Space-hold = temporary pan mode.
 *
 * Tracks the spacebar in a ref so the high-frequency pointer-move
 * handler can branch without re-rendering. Defensively resets on
 * window blur — if the user Cmd-Tabs away while holding space, the
 * keyup event fires on the other app, leaving spaceHeldRef true
 * forever. Without the blur reset, the next click in our viewport
 * pans instead of dragging.
 *
 * Space is only claimed when focus is on the board (or nowhere — the
 * usual state for a mouse user hovering the canvas) and not on a
 * button inside it. It used to preventDefault() Space window-wide,
 * which stopped every button on the page activating from the keyboard
 * (WCAG 2.1.1).
 */
export function useSpaceHoldPan(
  spaceHeldRef: MutableRefObject<boolean>,
  viewportRef: RefObject<HTMLElement | null>
) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === " " && !spaceHeldRef.current) {
        const target = e.target;
        const unfocused = target === document.body || target === document;
        if (!unfocused && !isInsideScope(target, viewportRef.current)) return;
        if (controlOwnsKey(target, e.key)) return;
        spaceHeldRef.current = true;
        e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") spaceHeldRef.current = false;
    };
    const onBlur = () => {
      spaceHeldRef.current = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
    // spaceHeldRef / viewportRef are stable; deps array intentionally empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * Zoom-to-cursor on wheel.
 *
 * R8: React's synthetic wheel listener is PASSIVE in React 17+ so
 * calling `e.preventDefault()` is a no-op and the browser still
 * scrolls the page beneath the canvas (Firefox/Safari especially
 * when the canvas sits in a scrollable parent). Attach a native
 * non-passive listener instead so we can prevent default. Also
 * normalises Firefox's line-mode (deltaMode=1) and page-mode
 * (deltaMode=2) deltas — bare deltaY varies 1.5× across browsers,
 * making zoom jumpy on Firefox.
 *
 * Suspended during presentation mode (the camera is fully owned by
 * the frame walker).
 */
export function useWheelZoom(params: {
  viewportRef: RefObject<HTMLDivElement | null>;
  viewportRectRef: RefObject<DOMRect | null>;
  camera: Camera;
  throttledSetCamera: (cam: Camera) => void;
  presentationFrameIndex: number | null;
}) {
  const { viewportRef, viewportRectRef, camera, throttledSetCamera, presentationFrameIndex } =
    params;

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (presentationFrameIndex !== null) return;
      // Only consume wheel when the pointer is over the canvas viewport.
      e.preventDefault();
      const rect = viewportRectRef.current;
      if (!rect) return;
      const focal = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      // Normalise deltaMode: 0=pixel, 1=line (~16px each), 2=page.
      const pxDelta =
        e.deltaMode === 1
          ? e.deltaY * 16
          : e.deltaMode === 2
            ? e.deltaY * window.innerHeight
            : e.deltaY;
      // Clamp the per-event zoom factor so a runaway driver (some Linux
      // trackpads emit deltaY > 2000) can't multiply zoom by 20× in one
      // event. Final clamp still happens inside zoomAt via clampZoom.
      const factor = Math.max(0.2, Math.min(5, Math.pow(1.0015, -pxDelta)));
      throttledSetCamera(zoomAt(camera, focal, camera.zoom * factor));
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
    // viewportRef / viewportRectRef are stable refs; omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, throttledSetCamera, presentationFrameIndex]);
}
