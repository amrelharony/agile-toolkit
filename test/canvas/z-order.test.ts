import { describe, it, expect } from "vitest";
import type { MutableRefObject } from "react";
import { claimNextZ, claimZRange } from "@/lib/whiteboard/z-order";

/**
 * Characterization tests for the atomic z-claim helpers. Their whole point is
 * mutate-as-you-return so back-to-back synchronous claims stay unique +
 * monotonic (paste-of-N, AI batch). Previously untested.
 */

const ref = (current: number): MutableRefObject<number> => ({ current });

describe("claimNextZ", () => {
  it("mutates the ref and returns current + 1", () => {
    const r = ref(5);
    expect(claimNextZ(r)).toBe(6);
    expect(r.current).toBe(6);
  });
  it("back-to-back claims are unique + monotonically increasing", () => {
    const r = ref(0);
    expect([claimNextZ(r), claimNextZ(r), claimNextZ(r)]).toEqual([1, 2, 3]);
    expect(r.current).toBe(3);
  });
  it("treats a null current as 0", () => {
    const r = { current: null } as unknown as MutableRefObject<number>;
    expect(claimNextZ(r)).toBe(1);
    expect(r.current).toBe(1);
  });
});

describe("claimZRange", () => {
  it("reserves N contiguous values and returns the base", () => {
    const r = ref(10);
    expect(claimZRange(r, 3)).toBe(11); // reserves 11,12,13
    expect(r.current).toBe(13);
    // The next single claim continues above the reserved block.
    expect(claimNextZ(r)).toBe(14);
  });
  it("count <= 0 returns the next value without reserving (no mutation)", () => {
    const r = ref(7);
    expect(claimZRange(r, 0)).toBe(8);
    expect(r.current).toBe(7);
    expect(claimZRange(r, -2)).toBe(8);
    expect(r.current).toBe(7);
  });
});
