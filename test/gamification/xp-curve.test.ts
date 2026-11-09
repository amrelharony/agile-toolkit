import { describe, expect, it } from "vitest";
import {
  MAX_LEVEL,
  awardingCrossesLevel,
  computeLevel,
  cumulativeXpForLevel,
  xpNeededForLevel,
} from "@/lib/gamification/xp-curve";

/**
 * Characterization of the level curve. The notification/XP redesign keeps it
 * unchanged, so these numbers must not move.
 */
describe("xp curve", () => {
  it("pins the cumulative XP for key levels", () => {
    expect(cumulativeXpForLevel(1)).toBe(0);
    expect(cumulativeXpForLevel(2)).toBe(100);
    expect(cumulativeXpForLevel(3)).toBe(348);
    expect(cumulativeXpForLevel(10)).toBe(5219);
    // Level 20 is about 20k XP (the comment used to say ~16k).
    expect(cumulativeXpForLevel(MAX_LEVEL)).toBe(20033);
    expect(cumulativeXpForLevel(MAX_LEVEL)).toBeGreaterThan(19_000);
    expect(cumulativeXpForLevel(MAX_LEVEL)).toBeLessThan(21_000);
  });

  it("scales by 20% per prestige", () => {
    expect(cumulativeXpForLevel(2, 1)).toBe(120);
    expect(cumulativeXpForLevel(10, 1)).toBe(6263);
  });

  it("computes level and progress, capping at MAX_LEVEL", () => {
    expect(computeLevel(0)).toMatchObject({ level: 1, xpIntoLevel: 0, atMax: false });
    expect(computeLevel(99).level).toBe(1);
    expect(computeLevel(100)).toMatchObject({ level: 2, xpIntoLevel: 0, xpNeededForLevel: 248 });
    expect(computeLevel(224).progress01).toBeCloseTo(0.5, 2);
    expect(computeLevel(1_000_000)).toMatchObject({ level: MAX_LEVEL, atMax: true, progress01: 1 });
    expect(xpNeededForLevel(MAX_LEVEL)).toBe(0);
  });

  it("detects a level crossing", () => {
    expect(awardingCrossesLevel(90, 5)).toBe(false);
    expect(awardingCrossesLevel(90, 10)).toBe(true);
  });
});
