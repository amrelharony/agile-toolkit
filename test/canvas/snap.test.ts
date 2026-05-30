import { describe, it, expect } from "vitest";
import {
  snapToGrid,
  buildSpatialIndex,
  snapToObjects,
  DEFAULT_GRID_SIZE,
} from "@/lib/whiteboard/snap";
import type { Rect } from "@/lib/geometry/bbox";

/**
 * Characterization tests for snap-to-grid + the spatial index + smart-alignment
 * guides — the drag hot path the pointer-machine calls on every pointermove.
 * Previously untested.
 */

describe("snapToGrid", () => {
  it("rounds to the nearest grid multiple (default 20)", () => {
    expect(snapToGrid({ x: 23, y: 38 })).toEqual({ x: 20, y: 40 });
    expect(snapToGrid({ x: 30, y: 30 })).toEqual({ x: 40, y: 40 }); // round-half-up
    expect(snapToGrid({ x: -23, y: -9 })).toEqual({ x: -20, y: -0 });
    expect(DEFAULT_GRID_SIZE).toBe(20);
  });
  it("respects a custom grid size", () => {
    expect(snapToGrid({ x: 17, y: 4 }, 10)).toEqual({ x: 20, y: 0 });
  });
});

describe("buildSpatialIndex", () => {
  it("reports the full input size and culls far candidates from nearby()", () => {
    const rects: Rect[] = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 1000, y: 1000, w: 10, h: 10 },
    ];
    const idx = buildSpatialIndex(rects);
    expect(idx.size).toBe(2);
    const near = idx.nearby({ x: 0, y: 0, w: 10, h: 10 }, 6);
    expect(near).toContainEqual(rects[0]);
    expect(near).not.toContainEqual(rects[1]);
  });

  it("skips non-finite + negative-size rects (but still counts them in size)", () => {
    const valid = { x: 5, y: 5, w: 10, h: 10 };
    const rects: Rect[] = [{ x: NaN, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: -5, h: 10 }, valid];
    const idx = buildSpatialIndex(rects);
    expect(idx.size).toBe(3);
    const near = idx.nearby({ x: 5, y: 5, w: 10, h: 10 }, 6);
    expect(near).toEqual([valid]);
  });
});

describe("snapToObjects", () => {
  it("returns the dragging rect unchanged with no guides when there are no others", () => {
    const drag = { x: 33, y: 44, w: 50, h: 50 };
    const { rect, guides } = snapToObjects(drag, []);
    expect(rect).toEqual(drag);
    expect(guides).toEqual([]);
  });

  it("snaps a left edge to a near object's left edge and emits a vertical guide", () => {
    const drag = { x: 103, y: 50, w: 50, h: 50 };
    const other = { x: 100, y: 400, w: 50, h: 50 };
    const { rect, guides } = snapToObjects(drag, [other], 6);
    expect(rect.x).toBe(100); // pulled onto other's left edge (Δ3 < tol 6)
    expect(rect.y).toBe(50); // no vertical alignment (other is far in Y)
    expect(guides).toHaveLength(1);
    expect(guides[0]).toMatchObject({ orientation: "vertical", position: 100 });
  });

  it("does not snap when every edge/center is beyond tolerance", () => {
    const drag = { x: 200, y: 200, w: 50, h: 50 };
    const other = { x: 100, y: 100, w: 50, h: 50 };
    const { rect, guides } = snapToObjects(drag, [other], 6);
    expect(rect).toEqual(drag);
    expect(guides).toEqual([]);
  });

  it("snaps on both axes when a near object aligns in X and Y (one guide per axis)", () => {
    // Several edge/center candidates are within tol on each axis; the tightest
    // (here left→left, Δ3) wins per axis, pulling the rect to (3, 3).
    const drag = { x: 0, y: 0, w: 100, h: 100 };
    const other = { x: 3, y: 3, w: 100, h: 100 };
    const { rect, guides } = snapToObjects(drag, [other], 6);
    expect(rect.x).toBe(3);
    expect(rect.y).toBe(3);
    expect(guides).toHaveLength(2);
  });
});
