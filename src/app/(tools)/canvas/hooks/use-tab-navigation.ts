"use client";

import { useEffect } from "react";
import { fitToRects } from "@/lib/whiteboard/canvas-transform";
import type { Camera } from "@/lib/geometry/bbox";

type ObjectLike = { id: string; x: number; y: number; w: number; h: number; z: number };

/**
 * Tab / Shift+Tab to cycle through objects in z-order (a11y).
 *
 * Without this, keyboard-only users can't navigate the board at all —
 * every object is mouse-pointer driven. Tab moves selection to the
 * next object in z-order; Shift+Tab moves backwards. After cycling,
 * the camera pans to keep the new selection visible (zoom is only
 * reduced, never increased — so a Tab through small distant objects
 * doesn't zoom the whole board out repeatedly).
 */
export function useTabNavigation(params: {
  objects: readonly ObjectLike[];
  selection: readonly string[];
  size: { w: number; h: number };
  camera: Camera;
  setSelection: (ids: string[]) => void;
  setCamera: (cam: Camera) => void;
}) {
  const { objects, selection, size, camera, setSelection, setCamera } = params;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (objects.length === 0) return;
      e.preventDefault();
      const ordered = objects.slice().sort((a, b) => a.z - b.z);
      const currentIdx = selection.length === 1
        ? ordered.findIndex((o) => o.id === selection[0])
        : -1;
      let nextIdx: number;
      if (e.shiftKey) {
        nextIdx = currentIdx <= 0 ? ordered.length - 1 : currentIdx - 1;
      } else {
        nextIdx = currentIdx >= ordered.length - 1 ? 0 : currentIdx + 1;
      }
      const next = ordered[nextIdx];
      if (!next) return;
      setSelection([next.id]);
      // Pan to keep the selection visible (10% margin around the
      // object's bbox). Don't override zoom unless we're way off.
      if (size.w > 0) {
        const cam = fitToRects([{ x: next.x, y: next.y, w: next.w, h: next.h }], size.w, size.h, 1.0);
        if (cam) setCamera({ x: cam.x, y: cam.y, zoom: Math.min(cam.zoom, camera.zoom) });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [objects, selection, size.w, size.h, camera.zoom, setSelection, setCamera]);
}
