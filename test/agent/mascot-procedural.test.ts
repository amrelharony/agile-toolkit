/**
 * Spring integration for the mascot's procedural animation (source springStep).
 */

import { describe, it, expect, vi } from "vitest";
import {
  springStep,
  createProceduralAnim,
  type Spring,
  type ProceduralCtx,
} from "@/components/agent/mascot/engine/procedural-anim";

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

describe("weightShift fidget", () => {
  it("leans to one consistent side instead of jittering each frame", () => {
    // Math.random()=0 → triggerRandomFidget picks FIDGET_TYPES[0] (weightShift)
    // and the lean direction resolves to -1 (0 > 0.5 is false).
    const rnd = vi.spyOn(Math, "random").mockReturnValue(0);
    const pa = createProceduralAnim();
    pa.triggerRandomFidget();

    const ctx: ProceduralCtx = {
      dt: 1 / 60,
      activeReaction: false,
      isTalking: false,
      isOpen: false,
      reducedMotion: false,
      hooks: { requestBlink() {}, emitSparkles() {} },
    };

    let minLean = 0;
    let maxLean = 0;
    // Stay inside the 2.0s fidget window (120 frames) so the measurement isn't
    // polluted by the post-reset spring settle.
    for (let i = 0; i < 110; i++) {
      const out = pa.update(ctx);
      minLean = Math.min(minLean, out.bodyLean);
      maxLean = Math.max(maxLean, out.bodyLean);
    }
    rnd.mockRestore();

    // Built a real lean to the chosen (negative) side…
    expect(minLean).toBeLessThan(-0.0015);
    // …and never swung to the opposite side. With the old per-frame sign
    // re-roll the target averaged to ~0, so the spring never built up a lean
    // and would have stayed near zero in both directions.
    expect(maxLean).toBeLessThan(0.0005);
  });
});
