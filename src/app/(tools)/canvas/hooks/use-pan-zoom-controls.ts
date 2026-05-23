"use client";

import { useEffect, type RefObject, type MutableRefObject } from "react";
import { zoomAt } from "@/lib/whiteboard/canvas-transform";
import type { Camera } from "@/lib/geometry/bbox";

/**
 * Space-hold = temporary pan mode.
 *
 * Tracks the spacebar in a ref so the high-frequency pointer-move
 * handler can branch without re-rendering. Defensively resets on
 * window blur — if the user Cmd-Tabs away while holding space, the
 * keyup event fires on the other app, leaving spaceHeldRef true
 * forever. Without the blur reset, the next click in our viewport
 * pans instead of dragging.
 */
export function useSpaceHoldPan(spaceHeldRef: MutableRefObject<boolean>) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === " " && !spaceHeldRef.current) {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
        spaceHeldRef.current = true;
        e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") spaceHeldRef.current = false;
    };
    const onBlur = () => { spaceHeldRef.current = false; };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
    // spaceHeldRef is stable; deps array intentionally empty.
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
  const { viewportRef, viewportRectRef, camera, throttledSetCamera, presentationFrameIndex } = params;

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
      const pxDelta = e.deltaMode === 1
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
