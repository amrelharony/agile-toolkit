// @vitest-environment node
/**
 * The three-point check's sums: (O + 4M + P) / 6 with a sixth of the gap
 * as the spread, the card a figure rounds up to, where Poker's check starts
 * from a revealed round, the note on the spread, and the typed-in checks.
 */

import { describe, expect, it } from "vitest";
import {
  THREE_POINT_MAX,
  cardAtOrAbove,
  formatPoints,
  isNumericDeck,
  numericCards,
  threePoint,
  threePointNote,
  threePointSpread,
  threePointStart,
  validateThreePoint,
} from "@/lib/estimation/three-point";
import { SCALES } from "@/lib/estimation/decks";

const FIB = SCALES.fibonacci;

describe("threePoint", () => {
  it("weighs the likely case four times and spreads a sixth of the gap", () => {
    const r = threePoint({ optimistic: 2, likely: 5, pessimistic: 13 });
    expect(r).not.toBeNull();
    expect(r!.expected).toBeCloseTo(35 / 6);
    expect(r!.sd).toBeCloseTo(11 / 6);
    expect(r!.low).toBeCloseTo(4);
    expect(r!.high).toBeCloseTo(46 / 6);
  });

  it("gives no spread when the three cases agree", () => {
    expect(threePoint({ optimistic: 5, likely: 5, pessimistic: 5 })).toEqual({
      expected: 5,
      sd: 0,
      low: 5,
      high: 5,
    });
  });

  it("never reaches below 0", () => {
    const r = threePoint({ optimistic: 0, likely: 0, pessimistic: 60 });
    expect(r!.low).toBe(0);
  });

  it("refuses cases out of order or out of range", () => {
    expect(threePoint({ optimistic: 5, likely: 3, pessimistic: 8 })).toBeNull();
    expect(threePoint({ optimistic: 1, likely: 8, pessimistic: 5 })).toBeNull();
    expect(threePoint({ optimistic: -1, likely: 2, pessimistic: 3 })).toBeNull();
    expect(threePoint({ optimistic: 1, likely: 2, pessimistic: THREE_POINT_MAX + 1 })).toBeNull();
    expect(threePoint({ optimistic: Number.NaN, likely: 2, pessimistic: 3 })).toBeNull();
    expect(threePoint({ optimistic: 0, likely: 0, pessimistic: THREE_POINT_MAX })).not.toBeNull();
  });
});

describe("the deck", () => {
  it("reads Fibonacci's and a custom deck's numbers, smallest first", () => {
    expect(numericCards(FIB)).toEqual(["1", "2", "3", "5", "8", "13", "21"]);
    expect(numericCards(["8", "1", "3", "?"])).toEqual(["1", "3", "8"]);
    expect(isNumericDeck(FIB)).toBe(true);
  });

  it("has no numbers on a T-shirt deck, or one that mixes sizes and numbers", () => {
    expect(numericCards(SCALES.tshirt)).toEqual([]);
    expect(numericCards(["1", "M", "3"])).toEqual([]);
    expect(isNumericDeck(SCALES.tshirt)).toBe(false);
  });

  it("rounds a figure up to the next card, or to the top card past it", () => {
    expect(cardAtOrAbove(FIB, 5.83)).toBe("8");
    expect(cardAtOrAbove(FIB, 5)).toBe("5");
    expect(cardAtOrAbove(FIB, 4.9999999999)).toBe("5");
    expect(cardAtOrAbove(FIB, 0)).toBe("1");
    expect(cardAtOrAbove(FIB, 40)).toBe("21");
    expect(cardAtOrAbove(SCALES.tshirt, 3)).toBeNull();
    expect(cardAtOrAbove(FIB, Number.NaN)).toBeNull();
  });
});

describe("threePointStart", () => {
  it("starts from the lowest, middle and highest vote", () => {
    expect(threePointStart(["3", "8", "5", "?"], FIB)).toEqual({
      optimistic: "3",
      likely: "5",
      pessimistic: "8",
    });
    // Two votes a card apart: the suggestion is the higher of the middle two.
    expect(threePointStart(["3", "8"], FIB)).toEqual({
      optimistic: "3",
      likely: "5",
      pessimistic: "8",
    });
  });

  it("needs two estimates on a numeric deck", () => {
    expect(threePointStart(["5"], FIB)).toBeNull();
    expect(threePointStart(["5", "?", "∞"], FIB)).toBeNull();
    expect(threePointStart(["S", "L"], SCALES.tshirt)).toBeNull();
  });

  it("keeps the likely case between the others on a deck typed out of order", () => {
    const deck = ["8", "1", "3"];
    const start = threePointStart(["1", "8", "3"], deck);
    expect(start).not.toBeNull();
    expect(Number(start!.optimistic)).toBeLessThanOrEqual(Number(start!.likely));
    expect(Number(start!.likely)).toBeLessThanOrEqual(Number(start!.pessimistic));
    expect(start).toEqual({ optimistic: "1", likely: "3", pessimistic: "8" });
  });
});

describe("the note", () => {
  it("reads narrow, some uncertainty or wide from the spread against the size", () => {
    expect(threePointSpread(threePoint({ optimistic: 5, likely: 5, pessimistic: 8 })!)).toBe(
      "narrow"
    );
    expect(threePointSpread(threePoint({ optimistic: 3, likely: 5, pessimistic: 8 })!)).toBe(
      "some"
    );
    expect(threePointSpread(threePoint({ optimistic: 2, likely: 5, pessimistic: 13 })!)).toBe(
      "wide"
    );
    expect(threePointSpread(threePoint({ optimistic: 0, likely: 0, pessimistic: 0 })!)).toBe(
      "narrow"
    );
    expect(threePointNote(threePoint({ optimistic: 2, likely: 5, pessimistic: 13 })!)).toMatch(
      /talk about the risks before you accept/
    );
  });

  it("formats figures with one decimal at most", () => {
    expect(formatPoints(35 / 6)).toBe("5.8");
    expect(formatPoints(6)).toBe("6");
    expect(formatPoints(5.96)).toBe("6");
  });
});

describe("validateThreePoint", () => {
  it("reads the typed cases as numbers", () => {
    expect(validateThreePoint({ optimistic: "2", likely: " 5 ", pessimistic: "13" })).toEqual({
      ok: true,
      values: { optimistic: 2, likely: 5, pessimistic: 13 },
    });
  });

  it("says which case is missing or not a number", () => {
    const r = validateThreePoint({ optimistic: "", likely: "abc", pessimistic: "2000" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.optimistic).toBe("Enter the best case.");
    expect(r.errors.likely).toBe("Make the likely case a number from 0 to 1000.");
    expect(r.errors.pessimistic).toBe("Make the worst case a number from 0 to 1000.");
  });

  it("puts an order error on the case that breaks it", () => {
    const likely = validateThreePoint({ optimistic: "5", likely: "3", pessimistic: "8" });
    expect(likely).toEqual({
      ok: false,
      errors: { likely: "The likely case can't be smaller than the best case." },
    });
    const worst = validateThreePoint({ optimistic: "1", likely: "8", pessimistic: "5" });
    expect(worst).toEqual({
      ok: false,
      errors: { pessimistic: "The worst case can't be smaller than the likely case." },
    });
  });
});
