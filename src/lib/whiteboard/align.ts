/**
 * Multi-object align + distribute.
 *
 * Six classic align operations (left / centre-x / right / top / centre-y /
 * bottom) and two distribute operations (horizontal / vertical equal-spacing).
 *
 * Each function takes a list of rects (already filtered to "movable"
 * objects by the caller; locked objects should be excluded) and returns
 * a map from id → new (x, y) so the caller can `upsertMany` and
 * version-bump.
 *
 * Math is in WORLD units — same coordinate space as everything else
 * on the canvas. No camera or zoom math here.
 */

import type { Rect } from "@/lib/geometry/bbox";

export interface AlignTarget {
  id: string;
  /** Bbox in world coords. */
  rect: Rect;
}

export interface AlignResult {
  /** New top-left in world coords for the object. */
  x: number;
  y: number;
}

export type AlignOp =
  | "align-left" | "align-center-x" | "align-right"
  | "align-top"  | "align-center-y" | "align-bottom";

export type DistributeOp = "distribute-h" | "distribute-v";

/**
 * Align operations align edges or centres against the union bbox of
 * the selection (Miro/Figma convention — not against the first or
 * last selected object).
 */
export function align(
  targets: readonly AlignTarget[],
  op: AlignOp,
): Record<string, AlignResult> {
  const out: Record<string, AlignResult> = {};
  if (targets.length < 2) return out;
  // Union bbox of the selection.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const t of targets) {
    if (t.rect.x < minX) minX = t.rect.x;
    if (t.rect.y < minY) minY = t.rect.y;
    if (t.rect.x + t.rect.w > maxX) maxX = t.rect.x + t.rect.w;
    if (t.rect.y + t.rect.h > maxY) maxY = t.rect.y + t.rect.h;
  }
  const unionCenterX = (minX + maxX) / 2;
  const unionCenterY = (minY + maxY) / 2;
  for (const t of targets) {
    let newX = t.rect.x;
    let newY = t.rect.y;
    switch (op) {
      case "align-left":      newX = minX; break;
      case "align-right":     newX = maxX - t.rect.w; break;
      case "align-center-x":  newX = unionCenterX - t.rect.w / 2; break;
      case "align-top":       newY = minY; break;
      case "align-bottom":    newY = maxY - t.rect.h; break;
      case "align-center-y":  newY = unionCenterY - t.rect.h / 2; break;
    }
    out[t.id] = { x: newX, y: newY };
  }
  return out;
}

/**
 * Distribute = equal spacing between rects along the axis. Requires
 * at least 3 rects (with 2, distribute is just align). Anchors the
 * leftmost/topmost and rightmost/bottommost rects in place; the
 * inner rects are evenly spaced.
 *
 * Spacing = gap between adjacent rects (not centre-to-centre) so it
 * works correctly with mixed-size objects.
 */
export function distribute(
  targets: readonly AlignTarget[],
  op: DistributeOp,
): Record<string, AlignResult> {
  const out: Record<string, AlignResult> = {};
  if (targets.length < 3) return out;
  const horizontal = op === "distribute-h";
  // Sort by leading edge along the active axis.
  const sorted = [...targets].sort((a, b) =>
    horizontal ? a.rect.x - b.rect.x : a.rect.y - b.rect.y,
  );
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  // Compute the gap that makes every adjacent pair equally spaced.
  // total span = leading edge of last − trailing edge of first
  // total width of all rects = sum of widths
  // gap × (n - 1) = span − sum(widths)
  let sumSize = 0;
  for (const t of sorted) sumSize += horizontal ? t.rect.w : t.rect.h;
  const span = horizontal
    ? last.rect.x + last.rect.w - first.rect.x
    : last.rect.y + last.rect.h - first.rect.y;
  // Clamp gap to 0 when the rects collectively exceed the span — a
  // negative gap would cause adjacent rects to overlap progressively,
  // compounding instead of distributing. With gap=0 the rects pack
  // tight from the leading edge; the trailing rect may still extend
  // past `last.rect.x + last.rect.w`, but no overlaps form.
  const gap = Math.max(0, (span - sumSize) / (sorted.length - 1));
  // First and last keep their positions; middle ones get redistributed.
  let cursor = horizontal ? first.rect.x : first.rect.y;
  for (const t of sorted) {
    if (horizontal) {
      out[t.id] = { x: cursor, y: t.rect.y };
      cursor += t.rect.w + gap;
    } else {
      out[t.id] = { x: t.rect.x, y: cursor };
      cursor += t.rect.h + gap;
    }
  }
  return out;
}
