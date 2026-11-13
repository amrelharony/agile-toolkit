// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  LAND_OFFSET,
  SPIN_TURNS,
  labelChars,
  landingRotation,
  sliceAtPointer,
  sliceLabel,
  slicePath,
  spinMotion,
  wheelSlices,
} from "@/lib/picker/wheel";
import {
  DICE_SIDES,
  coinText,
  diceLabel,
  diceResultText,
  randomLetter,
  randomNumber,
  rollDice,
  validateNumberRange,
  yesNo,
} from "@/lib/picker/randomizers";
import {
  MAX_THEME_DRAW,
  NAME_THEMES,
  drawThemeNames,
  fallbackThemeNames,
  themeForText,
} from "@/lib/picker/themes";
import { createRng } from "@/lib/utils/random";

/**
 * The wheel's geometry (every phone works the landing out the same way and
 * stops on the winner), the quick randomizers, and the themed name lists
 * the AI task falls back to.
 */

describe("wheel geometry", () => {
  it("sizes slices by weight into one full turn", () => {
    const s = wheelSlices([1, 2, 1]);
    expect(s.map((x) => [x.start, x.end])).toEqual([
      [0, 90],
      [90, 270],
      [270, 360],
    ]);
    expect(wheelSlices([])).toEqual([]);
    expect(wheelSlices([9, "x" as unknown as number])[0].end).toBeCloseTo(300);
  });

  it("lands the pointer on the winner for any wheel, seed and starting point", () => {
    const rng = createRng("land");
    for (let n = 1; n <= 40; n++) {
      const weights = Array.from({ length: n }, () => 1 + Math.floor(rng() * 5));
      const slices = wheelSlices(weights);
      const winner = Math.floor(rng() * n);
      const { turns, offset } = spinMotion(rng);
      const from = rng() * 5000;
      const r = landingRotation(slices, winner, turns, offset, from);
      expect(sliceAtPointer(slices, r)).toBe(winner);
      expect(r).toBeGreaterThanOrEqual(from + turns * 360);
      expect(r).toBeLessThan(from + (turns + 1) * 360);
    }
  });

  it("turns 4 to 7 times and stops away from a slice's edges", () => {
    const rng = createRng(3);
    for (let i = 0; i < 200; i++) {
      const m = spinMotion(rng);
      expect(m.turns).toBeGreaterThanOrEqual(SPIN_TURNS.min);
      expect(m.turns).toBeLessThanOrEqual(SPIN_TURNS.max);
      expect(m.offset).toBeGreaterThanOrEqual(LAND_OFFSET.min);
      expect(m.offset).toBeLessThanOrEqual(LAND_OFFSET.max);
    }
  });

  it("draws a slice, the whole disc for one name, and short labels", () => {
    expect(slicePath(100, 100, 92, { start: 0, end: 90, mid: 45 })).toBe(
      "M 100 100 L 100 8 A 92 92 0 0 1 192 100 Z"
    );
    expect(slicePath(100, 100, 92, { start: 0, end: 360, mid: 180 })).toContain("A 92 92 0 1 1");
    expect(sliceLabel("Christopher", 8)).toBe("Christo…");
    expect(sliceLabel("Sam", 8)).toBe("Sam");
    expect(labelChars(4)).toBeGreaterThan(labelChars(30));
  });
});

describe("randomizers", () => {
  it("rolls one to six dice of the allowed sides", () => {
    const rng = createRng(9);
    const roll = rollDice(3, 20, rng);
    expect(roll.rolls).toHaveLength(3);
    for (const r of roll.rolls) expect(r).toBeGreaterThanOrEqual(1);
    for (const r of roll.rolls) expect(r).toBeLessThanOrEqual(20);
    expect(roll.total).toBe(roll.rolls.reduce((a, b) => a + b, 0));
    expect(() => rollDice(7, 6)).toThrow(RangeError);
    expect(() => rollDice(1, 7)).toThrow(RangeError);
    expect(DICE_SIDES).toEqual([4, 6, 8, 10, 12, 20]);
    expect(diceLabel(2, 6)).toBe("2d6");
    expect(diceResultText({ rolls: [4], total: 4 })).toBe("4");
    expect(diceResultText({ rolls: [4, 2], total: 6 })).toBe("4 + 2 = 6");
  });

  it("flips, answers yes or no and picks letters and numbers", () => {
    const rng = createRng(1);
    expect(["Heads", "Tails"]).toContain(coinText(rng));
    expect(["Yes", "No"]).toContain(yesNo(rng));
    expect(randomLetter(rng)).toMatch(/^[A-Z]$/);
    const n = randomNumber(5, 7, rng);
    expect(n).toBeGreaterThanOrEqual(5);
    expect(n).toBeLessThanOrEqual(7);
  });

  it("checks a number range: blank, not whole, too far, the wrong way round", () => {
    expect(validateNumberRange({ min: "1", max: "6" })).toEqual({
      ok: true,
      values: { min: 1, max: 6 },
    });
    expect(validateNumberRange({ min: "", max: "6" })).toMatchObject({
      ok: false,
      errors: { min: "Enter the lowest number." },
    });
    expect(validateNumberRange({ min: "1.5", max: "6" })).toMatchObject({
      errors: { min: "Use a whole number." },
    });
    expect(validateNumberRange({ min: "1", max: "2000000" })).toMatchObject({
      errors: { max: "Keep it within a million either side of zero." },
    });
    expect(validateNumberRange({ min: "9", max: "3" })).toMatchObject({
      errors: { max: "The highest number must be at least the lowest." },
    });
  });
});

describe("themed names", () => {
  it("keeps every list our own: twenty or more short names, each once", () => {
    for (const t of NAME_THEMES) {
      expect(t.names.length, t.id).toBeGreaterThanOrEqual(MAX_THEME_DRAW);
      expect(new Set(t.names).size, t.id).toBe(t.names.length);
      for (const n of t.names) expect(n.length, n).toBeLessThanOrEqual(30);
    }
  });

  it("draws names from a theme, each once", () => {
    const names = drawThemeNames("rivers", 8, createRng(2));
    expect(names).toHaveLength(8);
    expect(new Set(names).size).toBe(8);
    expect(drawThemeNames("nope", 3)).toEqual([]);
  });

  it("matches a typed theme to a list, and draws the same names for the same seed", () => {
    expect(themeForText("Space missions")?.id).toBe("planets");
    expect(themeForText("Things in the garden")?.id).toBe("trees");
    expect(themeForText("jazz legends")).toBeUndefined();
    // Team Mixer's lists and matching live here too: spices, and the start
    // of a word from 3 letters (one or two letters match nothing).
    expect(themeForText("Spices")?.id).toBe("spices");
    expect(themeForText(" riv ")?.id).toBe("rivers");
    expect(themeForText("isl")?.id).toBe("islands");
    expect(themeForText("ri")).toBeUndefined();
    expect(themeForText("")).toBeUndefined();
    expect(themeForText("rainbow")?.id).toBe("colours");
    const a = fallbackThemeNames("Rivers of the world", 5, 1);
    expect(a).toEqual(fallbackThemeNames("rivers of the world", 5, 1));
    expect(NAME_THEMES.find((t) => t.id === "rivers")!.names).toEqual(expect.arrayContaining(a));
    expect(fallbackThemeNames("jazz legends", 20)).toHaveLength(20);
  });
});
