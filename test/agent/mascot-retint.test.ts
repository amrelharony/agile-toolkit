/**
 * Skin-retint pixel pass — ported from the vanilla mascot's retintSkin. Warm
 * skin-tone pixels blend toward the target tone (luminance-preserving); greys,
 * darks, over-bright, and non-warm (e.g. the olive suit) pixels are untouched.
 */

import { describe, it, expect } from "vitest";
import { retintImageData } from "@/components/agent/mascot/engine/retint-skin";

/** Build a 1-pixel RGBA buffer. */
function px(r: number, g: number, b: number, a = 255): Uint8ClampedArray {
  return new Uint8ClampedArray([r, g, b, a]);
}

describe("retintImageData", () => {
  it("shifts a warm skin pixel toward the target tone (luminance-preserving)", () => {
    const d = px(200, 150, 110);
    retintImageData(d);
    expect([d[0], d[1], d[2]]).toEqual([220, 163, 124]);
    expect(d[3]).toBe(255); // alpha preserved
  });

  it("leaves a neutral grey pixel untouched (saturation too low)", () => {
    const d = px(128, 128, 128);
    retintImageData(d);
    expect([d[0], d[1], d[2]]).toEqual([128, 128, 128]);
  });

  it("leaves a dark pixel untouched (r < 60)", () => {
    const d = px(40, 30, 20);
    retintImageData(d);
    expect([d[0], d[1], d[2]]).toEqual([40, 30, 20]);
  });

  it("leaves the olive suit untouched (r - g < 5 → too grey/green)", () => {
    const d = px(90, 90, 58);
    retintImageData(d);
    expect([d[0], d[1], d[2]]).toEqual([90, 90, 58]);
  });

  it("leaves an over-bright pixel untouched (brightness > 230)", () => {
    const d = px(245, 240, 235);
    retintImageData(d);
    expect([d[0], d[1], d[2]]).toEqual([245, 240, 235]);
  });

  it("clamps results into [0,255]", () => {
    // A very bright warm pixel still in-range (brightness ≤ 230) — verify no
    // channel escapes the byte range after the blend.
    const d = px(220, 170, 130);
    retintImageData(d);
    for (const c of [d[0], d[1], d[2]]) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(255);
    }
  });

  it("processes every pixel in a multi-pixel buffer independently", () => {
    const d = new Uint8ClampedArray([
      200,
      150,
      110,
      255, // warm → shifts
      128,
      128,
      128,
      255, // grey → untouched
    ]);
    retintImageData(d);
    expect([d[0], d[1], d[2]]).toEqual([220, 163, 124]);
    expect([d[4], d[5], d[6]]).toEqual([128, 128, 128]);
  });
});
