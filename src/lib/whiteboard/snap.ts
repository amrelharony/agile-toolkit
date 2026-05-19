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
 * Spatial-grid index over a static rect collection.
 *
 * R10-deferred: `snapToObjects` previously walked EVERY other object
 * on every pointer-move during drag. At 1000 stickies × 18 testX/Y
 * calls × 120Hz on high-refresh = ~2.16M ops/sec just for snap.
 *
 * Build this index once at drag-start (rects don't change during a
 * drag), then query `nearby(dragRect, tol)` per pointer-move. The
 * index buckets rects into a uniform grid and a candidate's rect
 * needs to be within `(tol + maxObjectExtent)` of the drag rect to
 * be a snap candidate at all. Bucketing collapses the per-tick
 * candidate count from O(N) to O(local-density).
 */
export interface SpatialIndex {
  /** Return rects whose center is within (tol + cell-extent) of the drag rect. */
  nearby(drag: Rect, tol: number): Rect[];
  /** Total rects indexed. */
  size: number;
}

export function buildSpatialIndex(rects: readonly Rect[], cellSize = 200): SpatialIndex {
  const buckets = new Map<string, Rect[]>();
  const key = (cx: number, cy: number) => `${Math.floor(cx / cellSize)}:${Math.floor(cy / cellSize)}`;
  // R11-fix: track the largest candidate half-extent across all
  // indexed rects. The previous reach formula only added cellSize/2 to
  // the drag half-extent, but a 600×40 frame sits in one bucket whose
  // center is 300+ units away from its edges — that candidate would
  // silently fall out of the candidate list for any drag more than
  // cellSize/2 from its center. By tracking the max extent, `nearby()`
  // can expand reach so every legitimately-near candidate is returned.
  let maxHalfExtent = 0;
  for (const r of rects) {
    // Skip rects with non-finite coords — they'd produce key="NaN:NaN"
    // and bucket every other NaN rect together, defeating spatial cull.
    if (!Number.isFinite(r.x) || !Number.isFinite(r.y) || !Number.isFinite(r.w) || !Number.isFinite(r.h)) continue;
    // R11-fix: reject negative dimensions. A negative-width rect would
    // place its center to the LEFT of its origin, bucketing it in the
    // wrong cell relative to its visual span; consumers would then
    // snap to an edge that doesn't visually exist.
    if (r.w < 0 || r.h < 0) continue;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const k = key(cx, cy);
    const bucket = buckets.get(k);
    if (bucket) bucket.push(r);
    else buckets.set(k, [r]);
    const half = Math.max(r.w, r.h) / 2;
    if (half > maxHalfExtent) maxHalfExtent = half;
  }
  return {
    nearby(drag, tol) {
      // The candidate bucket span: the drag rect could snap against
      // any rect whose CENTER is within (tol + drag half-extent +
      // candidate half-extent + cell half-extent) of the drag center.
      const dcx = drag.x + drag.w / 2;
      const dcy = drag.y + drag.h / 2;
      // Use the tracked max candidate extent so wide/tall frames
      // aren't pruned. Also clamp to a sane upper bound to defend
      // against pathological tol/cellSize ratios.
      const dragHalf = Math.max(drag.w, drag.h) / 2;
      const reach = Math.min(
        tol + dragHalf + maxHalfExtent + cellSize / 2,
        cellSize * 50,
      );
      const minX = Math.floor((dcx - reach) / cellSize);
      const maxX = Math.floor((dcx + reach) / cellSize);
      const minY = Math.floor((dcy - reach) / cellSize);
      const maxY = Math.floor((dcy + reach) / cellSize);
      const out: Rect[] = [];
      for (let bx = minX; bx <= maxX; bx++) {
        for (let by = minY; by <= maxY; by++) {
          const bucket = buckets.get(`${bx}:${by}`);
          if (bucket) for (const r of bucket) out.push(r);
        }
      }
      return out;
    },
    size: rects.length,
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
  // R11-fix: track candidates instead of emitting guides per match.
  // The previous loop pushed a guide for EVERY within-tol match across
  // all candidates, then dedup'd by (orientation, position) at the
  // end — but the dedup kept FIRST-seen, not the winning-snap-source.
  // Result: 50 dotted lines on a busy board, only one of which matched
  // the actual snap. Now: collect candidate guides keyed by their
  // target position, then keep ONLY the guides whose target equals
  // the winning snap source (one per axis).
  type Candidate = { target: number; rangeMin: number; rangeMax: number };
  const xCandidates: Candidate[] = [];
  const yCandidates: Candidate[] = [];
  // Track which targets produced the current best snap (so we emit
  // guides whose `target === winningTargetX/Y` after the loop).
  let winningTargetX: number | null = null;
  let winningTargetY: number | null = null;

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

    const testX = (edge: number, target: number, newX: number) => {
      const d = Math.abs(edge - target);
      if (d >= tol) return;
      if (d < bestDx) {
        bestDx = d;
        snapX = newX;
        winningTargetX = target;
      }
      xCandidates.push({ target, rangeMin: guideTopY, rangeMax: guideBotY });
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

    const testY = (edge: number, target: number, newY: number) => {
      const d = Math.abs(edge - target);
      if (d >= tol) return;
      if (d < bestDy) {
        bestDy = d;
        snapY = newY;
        winningTargetY = target;
      }
      yCandidates.push({ target, rangeMin: guideLeftX, rangeMax: guideRightX });
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

  // Emit one guide per winning axis, using the union range across all
  // candidates that match the winning target — gives the user a
  // single clear line per snap source.
  const dedupedGuides: AlignmentGuide[] = [];
  if (winningTargetX !== null) {
    let rangeMin = Infinity;
    let rangeMax = -Infinity;
    for (const c of xCandidates) {
      if (c.target === winningTargetX) {
        if (c.rangeMin < rangeMin) rangeMin = c.rangeMin;
        if (c.rangeMax > rangeMax) rangeMax = c.rangeMax;
      }
    }
    dedupedGuides.push({ orientation: "vertical", position: winningTargetX, rangeMin, rangeMax });
  }
  if (winningTargetY !== null) {
    let rangeMin = Infinity;
    let rangeMax = -Infinity;
    for (const c of yCandidates) {
      if (c.target === winningTargetY) {
        if (c.rangeMin < rangeMin) rangeMin = c.rangeMin;
        if (c.rangeMax > rangeMax) rangeMax = c.rangeMax;
      }
    }
    dedupedGuides.push({ orientation: "horizontal", position: winningTargetY, rangeMin, rangeMax });
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
