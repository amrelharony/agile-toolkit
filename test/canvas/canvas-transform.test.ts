import { describe, it, expect } from "vitest";
import {
  ZOOM_MIN,
  ZOOM_MAX,
  clampZoom,
  zoomAt,
  panBy,
  centerOn,
  fitToRects,
  resetCamera,
} from "@/lib/whiteboard/canvas-transform";
import { worldToScreen, type Camera } from "@/lib/geometry/bbox";

/**
 * Characterization tests for the canvas camera math (pan / zoom-to-cursor /
 * fit-to-content). Previously untested. Emphasis on the invariants (focal point
 * stays under the cursor) and the corrupt-state guards (non-finite zoom, NaN
 * rects) that keep the canvas from blanking out.
 */

const cam = (x: number, y: number, zoom: number): Camera => ({ x, y, zoom });

describe("clampZoom", () => {
  it("clamps into [ZOOM_MIN, ZOOM_MAX]", () => {
    expect(clampZoom(0.01)).toBe(ZOOM_MIN);
    expect(clampZoom(100)).toBe(ZOOM_MAX);
    expect(clampZoom(2)).toBe(2);
  });
  it("collapses non-finite to 1", () => {
    expect(clampZoom(NaN)).toBe(1);
    expect(clampZoom(Infinity)).toBe(1);
  });
});

describe("zoomAt", () => {
  it("keeps the world point under the focal screen point fixed", () => {
    const c = cam(100, 50, 1);
    const focal = { x: 300, y: 200 };
    const next = zoomAt(c, focal, 2);
    expect(next.zoom).toBe(2);
    // The world point under the focal point must be identical before & after.
    const worldBefore = { x: c.x + focal.x / c.zoom, y: c.y + focal.y / c.zoom };
    const worldAfter = { x: next.x + focal.x / next.zoom, y: next.y + focal.y / next.zoom };
    expect(worldAfter.x).toBeCloseTo(worldBefore.x);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y);
  });
  it("clamps the target zoom", () => {
    expect(zoomAt(cam(0, 0, 1), { x: 0, y: 0 }, 999).zoom).toBe(ZOOM_MAX);
  });
});

describe("panBy", () => {
  it("translates by a screen delta scaled into world units", () => {
    expect(panBy(cam(100, 100, 2), 20, 40)).toEqual({ x: 100 - 10, y: 100 - 20, zoom: 2 });
  });
  it("guards a corrupt zoom (treats it as 1)", () => {
    expect(panBy(cam(0, 0, 0), 10, 10)).toEqual({ x: -10, y: -10, zoom: 1 });
  });
});

describe("centerOn", () => {
  it("places the world point at the viewport center", () => {
    const next = centerOn(cam(0, 0, 1), { x: 500, y: 400 }, 800, 600);
    const screen = worldToScreen({ x: 500, y: 400 }, next);
    expect(screen.x).toBeCloseTo(400);
    expect(screen.y).toBeCloseTo(300);
  });
});

describe("fitToRects", () => {
  it("returns null for empty input or a zero-size viewport", () => {
    expect(fitToRects([], 800, 600)).toBeNull();
    expect(fitToRects([{ x: 0, y: 0, w: 10, h: 10 }], 0, 600)).toBeNull();
  });
  it("returns null when every rect is corrupt (NaN / negative size)", () => {
    expect(
      fitToRects(
        [
          { x: NaN, y: 0, w: 10, h: 10 },
          { x: 0, y: 0, w: -5, h: 10 },
        ],
        800,
        600
      )
    ).toBeNull();
  });
  it("returns null for a degenerate (single-point) union rather than resetting zoom", () => {
    expect(fitToRects([{ x: 5, y: 5, w: 0, h: 0 }], 800, 600)).toBeNull();
  });
  it("produces a finite, in-range camera that frames the content inside the viewport", () => {
    const rect = { x: 0, y: 0, w: 200, h: 100 };
    const c = fitToRects([rect], 800, 600);
    expect(c).not.toBeNull();
    const camOut = c!;
    expect(Number.isFinite(camOut.x)).toBe(true);
    expect(Number.isFinite(camOut.y)).toBe(true);
    expect(camOut.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
    expect(camOut.zoom).toBeLessThanOrEqual(ZOOM_MAX);
    // The content's screen bbox sits within the viewport (padding keeps it off
    // the edges).
    const tl = worldToScreen({ x: rect.x, y: rect.y }, camOut);
    const br = worldToScreen({ x: rect.x + rect.w, y: rect.y + rect.h }, camOut);
    expect(tl.x).toBeGreaterThanOrEqual(-1);
    expect(tl.y).toBeGreaterThanOrEqual(-1);
    expect(br.x).toBeLessThanOrEqual(801);
    expect(br.y).toBeLessThanOrEqual(601);
  });
});

describe("resetCamera", () => {
  it("returns origin at 100%", () => {
    expect(resetCamera()).toEqual({ x: 0, y: 0, zoom: 1 });
  });
});
