/**
 * Camera helpers — pan, zoom, fit-to-content, zoom-to-cursor.
 *
 * The canvas is laid out in world coordinates. A single CSS transform on the
 * canvas root applies `cam`: `translate(-cam.x*z, -cam.y*z) scale(z)`. Every
 * object renders at its world (x, y) and the transform handles the rest.
 */

import type { Camera, Rect, Vec2 } from "@/lib/geometry/bbox";
import { rectUnion } from "@/lib/geometry/bbox";

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 8;

export function clampZoom(z: number): number {
  // Anything non-finite (NaN, Infinity from a corrupted persisted state)
  // collapses to 1. Without this guard, downstream `/ cam.zoom` produces
  // NaN/Infinity that propagates through every render.
  if (!Number.isFinite(z)) return 1;
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
}

/** Defensive read of cam.zoom that guarantees a finite, non-zero value. */
function safeZoom(z: number): number {
  if (!Number.isFinite(z) || z <= 0) return 1;
  return z;
}

/**
 * Zoom toward a screen-space focal point — the world point under the
 * cursor stays under the cursor after the zoom. This is the only zoom
 * UX users find acceptable in an infinite canvas.
 */
export function zoomAt(cam: Camera, focalScreen: Vec2, nextZoom: number): Camera {
  const z = clampZoom(nextZoom);
  const cz = safeZoom(cam.zoom);
  // World point currently under the focal screen point.
  const worldX = cam.x + focalScreen.x / cz;
  const worldY = cam.y + focalScreen.y / cz;
  // After zoom change, recompute cam.x/y so that same world point lands
  // at the same focalScreen position.
  return {
    x: worldX - focalScreen.x / z,
    y: worldY - focalScreen.y / z,
    zoom: z,
  };
}

/** Translate the camera by a screen-space delta (e.g. drag-to-pan in px). */
export function panBy(cam: Camera, dxScreen: number, dyScreen: number): Camera {
  const cz = safeZoom(cam.zoom);
  return {
    x: cam.x - dxScreen / cz,
    y: cam.y - dyScreen / cz,
    zoom: cz,
  };
}

/** Center a world point in the viewport. */
export function centerOn(cam: Camera, worldPoint: Vec2, screenW: number, screenH: number): Camera {
  const cz = safeZoom(cam.zoom);
  return {
    x: worldPoint.x - screenW / 2 / cz,
    y: worldPoint.y - screenH / 2 / cz,
    zoom: cz,
  };
}

/**
 * Fit the union of `rects` into the viewport with a margin (default 10% on
 * each side). If `rects` is empty, returns the camera unchanged.
 *
 * Defensive: rejects non-finite or negative-size rects so a corrupt object
 * (e.g. one that survived a buggy resize) doesn't poison the zoom math.
 */
export function fitToRects(
  rects: readonly Rect[],
  screenW: number,
  screenH: number,
  padding = 0.1,
): Camera | null {
  if (rects.length === 0 || screenW <= 0 || screenH <= 0) return null;
  // Filter rects to finite + non-negative dimensions. Without this, a
  // single corrupted rect (NaN, -Infinity, negative w/h) makes the union
  // computation produce NaN and the resulting zoom becomes NaN — the
  // canvas blanks out until the user manually resets the camera.
  const valid = rects.filter(
    (r) =>
      Number.isFinite(r.x) && Number.isFinite(r.y) &&
      Number.isFinite(r.w) && Number.isFinite(r.h) &&
      r.w >= 0 && r.h >= 0,
  );
  if (valid.length === 0) return null;
  let union = valid[0];
  for (let i = 1; i < valid.length; i++) union = rectUnion(union, valid[i]);
  if (union.w <= 0 || union.h <= 0) {
    // R8: previously snapped zoom to 1× on a single-point union, which
    // SILENTLY reset the camera even when the user was at zoom=4. Return
    // null so the caller keeps the current camera; presentation-mode
    // / find-bar already handle null by leaving the camera untouched.
    return null;
  }
  // R8: floor pad at 20px (world units) so a pixel-perfect rect doesn't
  // fill the entire viewport edge-to-edge. Without this, a 1-pixel rect
  // computed `padW = 0.1px` → image cropped at the exact boundary.
  const padW = Math.max(union.w * padding, 20);
  const padH = Math.max(union.h * padding, 20);
  const targetW = union.w + padW * 2;
  const targetH = union.h + padH * 2;
  const zoom = clampZoom(Math.min(screenW / targetW, screenH / targetH));
  const x = union.x - padW - (screenW / zoom - targetW) / 2;
  const y = union.y - padH - (screenH / zoom - targetH) / 2;
  // Final sanity check — even with input validation, downstream zoom can
  // collapse to NaN if any of the divisions produced subnormal results.
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom)) return null;
  return { x, y, zoom };
}

/** Convenience for the "reset view" button — back to (0, 0) at 100%. */
export function resetCamera(): Camera {
  return { x: 0, y: 0, zoom: 1 };
}
