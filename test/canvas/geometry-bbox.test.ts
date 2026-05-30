import { describe, it, expect } from "vitest";
import {
  worldToScreen,
  screenToWorld,
  viewportWorldRect,
  pointInRect,
  pointOnSegment,
  aabbIntersect,
  aabbContains,
  inflate,
  rotateRect,
  boundingBoxOfPoints,
  boundingBoxOfFlatPoints,
  rectFromCorners,
  rectUnion,
  rectCenter,
  distance,
  pointInPolygon,
  rectOverlapsPolygon,
  type Camera,
} from "@/lib/geometry/bbox";

/**
 * Characterization tests for the canvas geometry primitives — pure AABB / point
 * / segment / polygon math the whole canvas (pointer-machine, snap, selection)
 * is built on. Previously had zero coverage. Heavy on the defensive guards
 * (NaN/zero zoom, odd-length flat arrays, degenerate polygons).
 */

const cam = (x: number, y: number, zoom: number): Camera => ({ x, y, zoom });

describe("world ↔ screen conversions", () => {
  it("worldToScreen / screenToWorld round-trip under pan + zoom", () => {
    const c = cam(100, 50, 2);
    const world = { x: 220, y: 90 };
    const screen = worldToScreen(world, c);
    expect(screen).toEqual({ x: (220 - 100) * 2, y: (90 - 50) * 2 });
    expect(screenToWorld(screen, c)).toEqual(world);
  });

  it("guards a corrupt zoom (0 / negative / NaN / Infinity) by falling back to 1", () => {
    const world = { x: 10, y: 20 };
    for (const z of [0, -1, NaN, Infinity]) {
      expect(worldToScreen(world, cam(0, 0, z))).toEqual({ x: 10, y: 20 });
    }
  });

  it("viewportWorldRect sizes the visible world by 1/zoom", () => {
    expect(viewportWorldRect(cam(5, 7, 2), 800, 600)).toEqual({ x: 5, y: 7, w: 400, h: 300 });
  });
});

describe("hit testing", () => {
  const r = { x: 0, y: 0, w: 100, h: 50 };
  it("pointInRect includes the boundary", () => {
    expect(pointInRect({ x: 50, y: 25 }, r)).toBe(true);
    expect(pointInRect({ x: 0, y: 0 }, r)).toBe(true);
    expect(pointInRect({ x: 100, y: 50 }, r)).toBe(true);
    expect(pointInRect({ x: 101, y: 25 }, r)).toBe(false);
    expect(pointInRect({ x: -1, y: 25 }, r)).toBe(false);
  });

  it("pointOnSegment respects tolerance and clamps to the segment", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 0 };
    expect(pointOnSegment({ x: 50, y: 0 }, a, b)).toBe(true);
    expect(pointOnSegment({ x: 50, y: 3 }, a, b, 4)).toBe(true);
    expect(pointOnSegment({ x: 50, y: 10 }, a, b, 4)).toBe(false);
    // Beyond the endpoint, but within tol of the clamped end.
    expect(pointOnSegment({ x: 102, y: 0 }, a, b, 4)).toBe(true);
    expect(pointOnSegment({ x: 120, y: 0 }, a, b, 4)).toBe(false);
  });

  it("pointOnSegment treats a zero-length segment as a tolerance disc", () => {
    const a = { x: 10, y: 10 };
    expect(pointOnSegment({ x: 12, y: 10 }, a, a, 4)).toBe(true);
    expect(pointOnSegment({ x: 20, y: 10 }, a, a, 4)).toBe(false);
  });

  it("aabbIntersect counts edge-touching as intersecting; disjoint as not", () => {
    expect(aabbIntersect(r, { x: 100, y: 0, w: 10, h: 10 })).toBe(true); // touching right edge
    expect(aabbIntersect(r, { x: 200, y: 0, w: 10, h: 10 })).toBe(false);
    expect(aabbIntersect(r, { x: 10, y: 10, w: 10, h: 10 })).toBe(true); // contained
  });

  it("aabbContains is strict containment", () => {
    expect(aabbContains(r, { x: 10, y: 10, w: 10, h: 10 })).toBe(true);
    expect(aabbContains(r, { x: 0, y: 0, w: 100, h: 50 })).toBe(true);
    expect(aabbContains(r, { x: 95, y: 0, w: 10, h: 10 })).toBe(false);
  });
});

describe("construction / transformation", () => {
  it("inflate grows symmetrically (single + separate dx/dy)", () => {
    expect(inflate({ x: 10, y: 10, w: 20, h: 20 }, 5)).toEqual({ x: 5, y: 5, w: 30, h: 30 });
    expect(inflate({ x: 10, y: 10, w: 20, h: 20 }, 5, 2)).toEqual({ x: 5, y: 8, w: 30, h: 24 });
  });

  it("rotateRect is a no-op at multiples of 360 and a tight AABB otherwise", () => {
    const base = { x: 0, y: 0, w: 100, h: 40 };
    expect(rotateRect(base, 0)).toBe(base);
    expect(rotateRect(base, 360)).toBe(base);
    // 90° swaps the AABB extents, centered on the same point.
    const r90 = rotateRect(base, 90);
    expect(r90.w).toBeCloseTo(40);
    expect(r90.h).toBeCloseTo(100);
    expect(rectCenter(r90)).toEqual({ x: 50, y: 20 });
    // 45°: both AABB extents become (w+h)·cos45 = 70√2 ≈ 98.99 for a 100×40
    // rect — taller than the original 40, but NARROWER than the original 100.
    const r45 = rotateRect(base, 45);
    expect(r45.w).toBeCloseTo(70 * Math.SQRT2);
    expect(r45.h).toBeCloseTo(70 * Math.SQRT2);
    expect(r45.h).toBeGreaterThan(40);
    expect(rectCenter(r45)).toEqual({ x: 50, y: 20 });
  });

  it("boundingBoxOfPoints handles empty / single / many", () => {
    expect(boundingBoxOfPoints([])).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(boundingBoxOfPoints([{ x: 5, y: 9 }])).toEqual({ x: 5, y: 9, w: 0, h: 0 });
    expect(
      boundingBoxOfPoints([
        { x: -2, y: 3 },
        { x: 4, y: -1 },
        { x: 1, y: 10 },
      ])
    ).toEqual({ x: -2, y: -1, w: 6, h: 11 });
  });

  it("boundingBoxOfFlatPoints defends against odd-length arrays", () => {
    expect(boundingBoxOfFlatPoints([])).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(boundingBoxOfFlatPoints([1])).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    // Trailing orphan x (no y) is dropped — no NaN leaks into w/h.
    const r = boundingBoxOfFlatPoints([0, 0, 10, 20, 99]);
    expect(r).toEqual({ x: 0, y: 0, w: 10, h: 20 });
    expect(Number.isNaN(r.h)).toBe(false);
  });

  it("rectFromCorners normalizes any corner order", () => {
    const expected = { x: 0, y: 0, w: 30, h: 20 };
    expect(rectFromCorners({ x: 0, y: 0 }, { x: 30, y: 20 })).toEqual(expected);
    expect(rectFromCorners({ x: 30, y: 20 }, { x: 0, y: 0 })).toEqual(expected);
    expect(rectFromCorners({ x: 30, y: 0 }, { x: 0, y: 20 })).toEqual(expected);
  });

  it("rectUnion covers both rects", () => {
    expect(rectUnion({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 5, w: 10, h: 10 })).toEqual({
      x: 0,
      y: 0,
      w: 30,
      h: 15,
    });
  });

  it("rectCenter + distance", () => {
    expect(rectCenter({ x: 0, y: 0, w: 100, h: 40 })).toEqual({ x: 50, y: 20 });
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe("polygon predicates", () => {
  // Square (0,0)-(10,10) as a flat array.
  const square = [0, 0, 10, 0, 10, 10, 0, 10];

  it("pointInPolygon is false for degenerate (<3 vertices)", () => {
    expect(pointInPolygon({ x: 1, y: 1 }, [0, 0, 10, 10])).toBe(false);
  });

  it("pointInPolygon detects inside vs outside", () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false);
    expect(pointInPolygon({ x: -1, y: -1 }, square)).toBe(false);
  });

  it("rectOverlapsPolygon: false for degenerate polygon (<6 flat)", () => {
    expect(rectOverlapsPolygon({ x: 0, y: 0, w: 1, h: 1 }, [0, 0, 1, 1])).toBe(false);
  });

  it("rectOverlapsPolygon: true when a corner/center is inside the polygon", () => {
    // rect center (5,5) inside the square.
    expect(rectOverlapsPolygon({ x: 2, y: 2, w: 6, h: 6 }, square)).toBe(true);
  });

  it("rectOverlapsPolygon: true when the polygon sits entirely inside the rect (BUG-L2)", () => {
    // Big rect, small square fully inside it — no rect corner is in the square,
    // but a polygon vertex is in the rect.
    expect(rectOverlapsPolygon({ x: -100, y: -100, w: 300, h: 300 }, square)).toBe(true);
  });

  it("rectOverlapsPolygon: false when fully disjoint", () => {
    expect(rectOverlapsPolygon({ x: 100, y: 100, w: 10, h: 10 }, square)).toBe(false);
  });
});
