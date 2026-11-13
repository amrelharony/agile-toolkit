/**
 * Picker's quick randomizers: dice, a coin, yes or no, a number in a range
 * and a letter. Each takes an optional seeded `rng` (lib/utils/random) and
 * returns what came up plus a line that says it, for the recent picks and a
 * live room's screen. Pure.
 */

import { flipCoin, randomInt, rollDie, type Rng } from "@/lib/utils/random";
import type { Validation } from "@/lib/utils/form";

export const DICE_SIDES = [4, 6, 8, 10, 12, 20] as const;
export type DiceSides = (typeof DICE_SIDES)[number];
export const MAX_DICE = 6;

/** A number range's ends stay within this, either side of zero. */
export const NUMBER_RANGE_LIMIT = 1_000_000;

export const isDiceSides = (n: unknown): n is DiceSides =>
  typeof n === "number" && (DICE_SIDES as readonly number[]).includes(n);

export interface DiceRoll {
  count: number;
  sides: DiceSides;
  rolls: number[];
  total: number;
}

/** "2d6": two six-sided dice. */
export function diceLabel(count: number, sides: number): string {
  return `${count}d${sides}`;
}

/** Roll `count` dice (1–6) of `sides` sides (4, 6, 8, 10, 12 or 20). */
export function rollDice(count: number, sides: number, rng?: Rng): DiceRoll {
  if (!Number.isInteger(count) || count < 1 || count > MAX_DICE) {
    throw new RangeError(`rollDice: 1 to ${MAX_DICE} dice (got ${count})`);
  }
  if (!isDiceSides(sides)) {
    throw new RangeError(`rollDice: a die has ${DICE_SIDES.join(", ")} sides (got ${sides})`);
  }
  const rolls = Array.from({ length: count }, () => rollDie(sides, rng));
  return { count, sides, rolls, total: rolls.reduce((n, r) => n + r, 0) };
}

/** "4", or "4 + 2 = 6" for several dice. */
export function diceResultText(roll: Pick<DiceRoll, "rolls" | "total">): string {
  return roll.rolls.length === 1
    ? String(roll.rolls[0])
    : `${roll.rolls.join(" + ")} = ${roll.total}`;
}

export function coinText(rng?: Rng): "Heads" | "Tails" {
  return flipCoin(rng) === "heads" ? "Heads" : "Tails";
}

export function yesNo(rng?: Rng): "Yes" | "No" {
  return (rng ? rng() : Math.random()) < 0.5 ? "Yes" : "No";
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** A capital letter, A to Z. */
export function randomLetter(rng?: Rng): string {
  return LETTERS[randomInt(0, LETTERS.length - 1, rng)];
}

export interface NumberRangeDraft {
  min: string;
  max: string;
}

/**
 * A range typed into the form: two whole numbers within a million either
 * side of zero, the first no bigger than the second. Blank is an error,
 * never a silent default.
 */
export function validateNumberRange(
  draft: NumberRangeDraft
): Validation<{ min: number; max: number }, "min" | "max"> {
  const errors: { min?: string; max?: string } = {};
  const read = (raw: string, field: "min" | "max", label: string): number | undefined => {
    const text = raw.trim();
    if (text === "") {
      errors[field] = `Enter the ${label} number.`;
      return undefined;
    }
    const n = Number(text);
    if (!Number.isInteger(n)) {
      errors[field] = "Use a whole number.";
      return undefined;
    }
    if (Math.abs(n) > NUMBER_RANGE_LIMIT) {
      errors[field] = "Keep it within a million either side of zero.";
      return undefined;
    }
    return n;
  };
  const min = read(draft.min, "min", "lowest");
  const max = read(draft.max, "max", "highest");
  if (min !== undefined && max !== undefined && min > max) {
    errors.max = "The highest number must be at least the lowest.";
  }
  if (errors.min || errors.max || min === undefined || max === undefined) {
    return { ok: false, errors };
  }
  return { ok: true, values: { min, max } };
}

/** A whole number from `min` to `max`, both included. */
export function randomNumber(min: number, max: number, rng?: Rng): number {
  return randomInt(min, max, rng);
}
