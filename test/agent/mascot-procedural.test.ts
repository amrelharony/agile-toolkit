/**
 * Spring integration for the mascot's procedural animation (source springStep).
 */

import { describe, it, expect } from "vitest";
import { springStep, type Spring } from "@/components/agent/mascot/engine/procedural-anim";

function spring(over: Partial<Spring> = {}): Spring {
  return { value: 0, velocity: 0, target: 0, stiffness: 100, damping: 20, ...over };
}

describe("springStep", () => {
  it("stays at rest when value === target === 0", () => {
    const s = spring();
    for (let i = 0; i < 120; i++) springStep(s, 1 / 60);
    expect(s.value).toBe(0);
    expect(s.velocity).toBe(0);
  });

  it("converges to the target", () => {
    const s = spring({ target: 1 });
    for (let i = 0; i < 300; i++) springStep(s, 1 / 60);
    expect(s.value).toBeCloseTo(1, 2);
    expect(Math.abs(s.velocity)).toBeLessThan(0.01);
  });

  it("does not blow up (bounded overshoot) for a stiff/underdamped spring", () => {
    const s = spring({ target: 1, stiffness: 200, damping: 14 });
    let maxAbs = 0;
    for (let i = 0; i < 600; i++) {
      springStep(s, 1 / 60);
      maxAbs = Math.max(maxAbs, Math.abs(s.value));
      expect(Number.isFinite(s.value)).toBe(true);
    }
    // Underdamped: overshoots above 1 but stays well bounded, then settles.
    expect(maxAbs).toBeLessThan(2);
    expect(s.value).toBeCloseTo(1, 1);
  });

  it("returns the updated value", () => {
    const s = spring({ target: 1 });
    const r = springStep(s, 1 / 60);
    expect(r).toBe(s.value);
    expect(r).toBeGreaterThan(0);
  });
});
