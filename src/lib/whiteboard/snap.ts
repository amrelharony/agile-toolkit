/**
 * Snap-to-grid + smart alignment guide computation.
 *
 * Alignment guides appear when the dragged object's edge or center is
 * within `tol` WORLD units of another object's edge/center. Callers
 * that want a screen-pixel-stable feel (recommended) should divide
 * their pixel tolerance by `camera.zoom` before passing it in — e.g.
 * a 6-pixel feel becomes 12 world units at 0.5× zoom. Without that
 * correction, snap pulls 2× as wide when zoomed out, 0.5× as wide
 * when zoomed in, which feels broken next to zoom-stable cursors.
 *
 * Result: a list of guide segments to render across the canvas + a
 * snapped position that pulls the dragged object onto the matching
 * edge.
 */

import type { Rect, Vec2 } from "@/lib/geometry/bbox";

export const DEFAULT_GRID_SIZE = 20;
export const DEFAULT_GUIDE_TOLERANCE = 6;

export interface AlignmentGuide {
  /** Vertical guide → constant x; horizontal guide → constant y. */
  orientation: "vertical" | "horizontal";
  position: number;
  /** Min/max along the orthogonal axis — used to draw the guide segment. */
  rangeMin: number;
  rangeMax: number;
}

export function snapToGrid(p: Vec2, size = DEFAULT_GRID_SIZE): Vec2 {
  return {
    x: Math.round(p.x / size) * size,
    y: Math.round(p.y / size) * size,
  };
}

/**
 * Compute alignment guides + a snapped rect for an object being dragged.
 *
 * `dragging` is the candidate next position. `others` are the rects to
 * check alignment against (all visible objects on the board minus the
 * one being dragged). Returns the snapped rect AND the guides that
 * triggered the snap, so the canvas can render them.
 *
 * Snaps to: left edge, center x, right edge, top edge, center y, bottom edge.
 */
export function snapToObjects(
  dragging: Rect,
  others: readonly Rect[],
  tol = DEFAULT_GUIDE_TOLERANCE,
): { rect: Rect; guides: AlignmentGuide[] } {
  let snapX: number | null = null;
  let snapY: number | null = null;
  const guides: AlignmentGuide[] = [];

  const dragLeft = dragging.x;
  const dragRight = dragging.x + dragging.w;
  const dragCenterX = dragging.x + dragging.w / 2;
  const dragTop = dragging.y;
  const dragBottom = dragging.y + dragging.h;
  const dragCenterY = dragging.y + dragging.h / 2;

  for (const o of others) {
    const oLeft = o.x;
    const oRight = o.x + o.w;
    const oCenterX = o.x + o.w / 2;
    const oTop = o.y;
    const oBottom = o.y + o.h;
    const oCenterY = o.y + o.h / 2;

    // Vertical alignments (constant x)
    const xCandidates: [number, number, number][] = [
      [dragLeft, oLeft, oLeft],
      [dragLeft, oRight, oRight],
      [dragLeft, oCenterX, oCenterX],
      [dragRight, oLeft, oLeft - dragging.w],
      [dragRight, oRight, oRight - dragging.w],
      [dragRight, oCenterX, oCenterX - dragging.w],
      [dragCenterX, oLeft, oLeft - dragging.w / 2],
      [dragCenterX, oRight, oRight - dragging.w / 2],
      [dragCenterX, oCenterX, oCenterX - dragging.w / 2],
    ];
    for (const [edge, target, newX] of xCandidates) {
      if (Math.abs(edge - target) < tol) {
        if (snapX === null || Math.abs(edge - target) < Math.abs((snapX + (edge - dragLeft)) - target)) {
          snapX = newX;
        }
        guides.push({
          orientation: "vertical",
          position: target,
          rangeMin: Math.min(dragTop, oTop) - 20,
          rangeMax: Math.max(dragBottom, oBottom) + 20,
        });
      }
    }

    // Horizontal alignments (constant y)
    const yCandidates: [number, number, number][] = [
      [dragTop, oTop, oTop],
      [dragTop, oBottom, oBottom],
      [dragTop, oCenterY, oCenterY],
      [dragBottom, oTop, oTop - dragging.h],
      [dragBottom, oBottom, oBottom - dragging.h],
      [dragBottom, oCenterY, oCenterY - dragging.h],
      [dragCenterY, oTop, oTop - dragging.h / 2],
      [dragCenterY, oBottom, oBottom - dragging.h / 2],
      [dragCenterY, oCenterY, oCenterY - dragging.h / 2],
    ];
    for (const [edge, target, newY] of yCandidates) {
      if (Math.abs(edge - target) < tol) {
        if (snapY === null || Math.abs(edge - target) < Math.abs((snapY + (edge - dragTop)) - target)) {
          snapY = newY;
        }
        guides.push({
          orientation: "horizontal",
          position: target,
          rangeMin: Math.min(dragLeft, oLeft) - 20,
          rangeMax: Math.max(dragRight, oRight) + 20,
        });
      }
    }
  }

  // De-dup guides on the same position to keep the render light.
  const dedupedGuides: AlignmentGuide[] = [];
  const seen = new Set<string>();
  for (const g of guides) {
    const key = `${g.orientation}:${g.position}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedupedGuides.push(g);
  }

  return {
    rect: {
      x: snapX ?? dragging.x,
      y: snapY ?? dragging.y,
      w: dragging.w,
      h: dragging.h,
    },
    guides: dedupedGuides,
  };
}
