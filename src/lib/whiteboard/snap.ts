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
 *
 * Hot path. The previous implementation allocated a 9-element
 * `[edge, target, newX][]` literal twice per `other` rect, which on a
 * 1000-object board burned ~18 000 small array allocations per
 * pointermove (millions/sec under sustained drag). This version unrolls
 * the candidate list into nine direct `testX` / `testY` calls — no
 * intermediate arrays, no tuple destructuring, same semantics.
 */
export function snapToObjects(
  dragging: Rect,
  others: readonly Rect[],
  tol = DEFAULT_GUIDE_TOLERANCE,
): { rect: Rect; guides: AlignmentGuide[] } {
  let snapX: number | null = null;
  let snapY: number | null = null;
  // Best (smallest) absolute deltas seen so far, used to pick the
  // tightest snap when multiple candidates match within tolerance. Avoids
  // re-computing the previous candidate's distance inside the loop the
  // way the old `Math.abs((snapX + (edge - dragLeft)) - target)` did.
  let bestDx = Infinity;
  let bestDy = Infinity;
  const guides: AlignmentGuide[] = [];

  const dragLeft = dragging.x;
  const dragRight = dragging.x + dragging.w;
  const dragCenterX = dragging.x + dragging.w / 2;
  const dragTop = dragging.y;
  const dragBottom = dragging.y + dragging.h;
  const dragCenterY = dragging.y + dragging.h / 2;
  const halfW = dragging.w / 2;
  const halfH = dragging.h / 2;

  for (const o of others) {
    const oLeft = o.x;
    const oRight = o.x + o.w;
    const oCenterX = o.x + o.w / 2;
    const oTop = o.y;
    const oBottom = o.y + o.h;
    const oCenterY = o.y + o.h / 2;
    const guideTopY = Math.min(dragTop, oTop) - 20;
    const guideBotY = Math.max(dragBottom, oBottom) + 20;
    const guideLeftX = Math.min(dragLeft, oLeft) - 20;
    const guideRightX = Math.max(dragRight, oRight) + 20;

    // Vertical alignments (constant x). Each `testX(edge, target, newX)`
    // is the body of the old candidate-array loop, unrolled and
    // alloc-free. The branch ordering is left-edge/right-edge/center —
    // identical semantics to the prior code.
    const testX = (edge: number, target: number, newX: number) => {
      const d = Math.abs(edge - target);
      if (d >= tol) return;
      if (d < bestDx) {
        bestDx = d;
        snapX = newX;
      }
      guides.push({
        orientation: "vertical",
        position: target,
        rangeMin: guideTopY,
        rangeMax: guideBotY,
      });
    };
    testX(dragLeft, oLeft, oLeft);
    testX(dragLeft, oRight, oRight);
    testX(dragLeft, oCenterX, oCenterX);
    testX(dragRight, oLeft, oLeft - dragging.w);
    testX(dragRight, oRight, oRight - dragging.w);
    testX(dragRight, oCenterX, oCenterX - dragging.w);
    testX(dragCenterX, oLeft, oLeft - halfW);
    testX(dragCenterX, oRight, oRight - halfW);
    testX(dragCenterX, oCenterX, oCenterX - halfW);

    // Horizontal alignments (constant y).
    const testY = (edge: number, target: number, newY: number) => {
      const d = Math.abs(edge - target);
      if (d >= tol) return;
      if (d < bestDy) {
        bestDy = d;
        snapY = newY;
      }
      guides.push({
        orientation: "horizontal",
        position: target,
        rangeMin: guideLeftX,
        rangeMax: guideRightX,
      });
    };
    testY(dragTop, oTop, oTop);
    testY(dragTop, oBottom, oBottom);
    testY(dragTop, oCenterY, oCenterY);
    testY(dragBottom, oTop, oTop - dragging.h);
    testY(dragBottom, oBottom, oBottom - dragging.h);
    testY(dragBottom, oCenterY, oCenterY - dragging.h);
    testY(dragCenterY, oTop, oTop - halfH);
    testY(dragCenterY, oBottom, oBottom - halfH);
    testY(dragCenterY, oCenterY, oCenterY - halfH);
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
