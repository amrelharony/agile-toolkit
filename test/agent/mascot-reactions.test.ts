/**
 * Micro-expression ramp intensity (source updateMicroExpressions): 0 → 1 over
 * the ramp-in, hold at 1, then 1 → 0 over the ramp-out.
 */

import { describe, it, expect } from "vitest";
import { microRampIntensity } from "@/components/agent/mascot/engine/reactions";

describe("microRampIntensity", () => {
  // duration 1.2, ramp 0.3 (the "smirk" expression).
  const D = 1.2;
  const R = 0.3;

  it("ramps in from 0 to 1 over the ramp window", () => {
    expect(microRampIntensity(0, D, R)).toBeCloseTo(0, 5);
    expect(microRampIntensity(0.15, D, R)).toBeCloseTo(0.5, 5);
    expect(microRampIntensity(0.3, D, R)).toBeCloseTo(1, 5);
  });

  it("holds at 1 through the middle", () => {
    expect(microRampIntensity(0.5, D, R)).toBe(1);
    expect(microRampIntensity(0.7, D, R)).toBe(1);
  });

  it("ramps out from 1 to 0 over the final window", () => {
    expect(microRampIntensity(0.9, D, R)).toBeCloseTo(1, 5); // duration - ramp
    expect(microRampIntensity(1.05, D, R)).toBeCloseTo(0.5, 5);
    expect(microRampIntensity(1.2, D, R)).toBeCloseTo(0, 5);
  });

  it("clamps to [0,1] outside the window", () => {
    expect(microRampIntensity(-1, D, R)).toBe(0);
    expect(microRampIntensity(5, D, R)).toBe(0);
  });
});
