/**
 * The modified Fibonacci scale WSJF scores each part on, relative to the
 * other items, and the backlog's one value field (BacklogItem.businessValue)
 * is held on: 1, 2, 3, 5, 8, 13, 20.
 */

import type { ScaleStep } from "./types";

export const FIBONACCI_VALUES = [1, 2, 3, 5, 8, 13, 20] as const;

/** The steps with what each means: sized against the other items, not in absolute units. */
export const FIBONACCI_STEPS: readonly ScaleStep[] = [
  { value: 1, meaning: "Smallest in the set" },
  { value: 2, meaning: "A little more than the smallest" },
  { value: 3, meaning: "Small" },
  { value: 5, meaning: "Medium" },
  { value: 8, meaning: "Large" },
  { value: 13, meaning: "Very large" },
  { value: 20, meaning: "Largest in the set" },
];

/**
 * The Fibonacci step at or above `n` (20 at most): how the old 1–10 matrix
 * value reads on the one value field's scale. 1→1, 2→2, 3→3, 4–5→5, 6–8→8,
 * 9–10→13; a step maps to itself, so reading twice changes nothing.
 * Undefined stays undefined; anything at or below 1 reads as 1.
 */
export function fibonacciAtOrAbove(n: number | undefined): number | undefined {
  if (n === undefined || !Number.isFinite(n)) return undefined;
  for (const step of FIBONACCI_VALUES) if (step >= n) return step;
  return FIBONACCI_VALUES[FIBONACCI_VALUES.length - 1];
}
