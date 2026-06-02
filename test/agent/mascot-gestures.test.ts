/**
 * Gesture detection (source detectGesture): a near-circular point path → circle,
 * a horizontally-oscillating path → zigzag, otherwise null.
 */

import { describe, it, expect } from "vitest";
import {
  analyzeGesture,
  type GesturePoint,
} from "@/components/agent/mascot/engine/interactions/gestures";

describe("analyzeGesture", () => {
  it("returns null for too few points", () => {
    expect(analyzeGesture([{ x: 0, y: 0 }])).toBeNull();
    expect(analyzeGesture(Array.from({ length: 11 }, (_, i) => ({ x: i, y: i })))).toBeNull();
  });

  it("detects a circle (full loop of points)", () => {
    const pts: GesturePoint[] = Array.from({ length: 16 }, (_, i) => {
      const a = (i / 16) * Math.PI * 2;
      return { x: 100 + 50 * Math.cos(a), y: 100 + 50 * Math.sin(a) };
    });
    expect(analyzeGesture(pts)).toBe("circle");
  });

  it("detects a zigzag (alternating horizontal direction)", () => {
    const pts: GesturePoint[] = Array.from({ length: 14 }, (_, i) => ({
      x: i % 2 === 0 ? 0 : 20,
      y: i * 8, // drift down so it isn't circular
    }));
    expect(analyzeGesture(pts)).toBe("zigzag");
  });

  it("returns null for a straight line", () => {
    const pts: GesturePoint[] = Array.from({ length: 14 }, (_, i) => ({
      x: i * 10,
      y: i * 10,
    }));
    expect(analyzeGesture(pts)).toBeNull();
  });
});
