/**
 * The three-point check: a best, a likely and a worst case for one story,
 * weighed as (best + 4 × likely + worst) / 6, with a sixth of the gap
 * between best and worst as the spread either side. It says how sure the
 * team is about a size, which one card can't.
 *
 * Planning Poker offers it to the host after Reveal (on a numeric deck),
 * starting from the votes; the Estimation Guide has a free-standing one;
 * Amr has `tool.planning_poker.three_point`. Nothing here is saved: the
 * host still picks and accepts a card.
 *
 * Pure: no React, no store. The agent actions call it on the server.
 */

import type { Validation } from "@/lib/utils/form";
import { consensusOf, estimateCards } from "./consensus";

/** The largest case the check takes, in points. */
export const THREE_POINT_MAX = 1000;

export interface ThreePointInput {
  optimistic: number;
  likely: number;
  pessimistic: number;
}

export interface ThreePointResult {
  /** (O + 4M + P) / 6. */
  expected: number;
  /** (P − O) / 6. */
  sd: number;
  /** expected − sd: never below 0, since O ≥ 0. */
  low: number;
  /** expected + sd. */
  high: number;
}

const inRange = (n: number) => Number.isFinite(n) && n >= 0 && n <= THREE_POINT_MAX;

/** The expected size and its spread, or null unless 0 ≤ O ≤ M ≤ P ≤ 1000. */
export function threePoint({
  optimistic: o,
  likely: m,
  pessimistic: p,
}: ThreePointInput): ThreePointResult | null {
  if (![o, m, p].every(inRange) || o > m || m > p) return null;
  const expected = (o + 4 * m + p) / 6;
  const sd = (p - o) / 6;
  return { expected, sd, low: Math.max(0, expected - sd), high: expected + sd };
}

/** A card as a number of points: "8" → 8; "M", "?", "" → null. */
function cardValue(card: string): number | null {
  const t = card.trim();
  if (!/^\d+(?:\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return inRange(n) ? n : null;
}

/**
 * The deck's estimate cards as numbers, smallest first: what the check's
 * pickers offer. Empty unless every estimate card is a number of points
 * (a T-shirt deck, or a custom one that mixes sizes and numbers, has no
 * numeric reading).
 */
export function numericCards(deck: readonly string[]): string[] {
  const cards = estimateCards(deck).map((c) => c.trim());
  if (cards.length === 0 || !cards.every((c) => cardValue(c) !== null)) return [];
  return Array.from(new Set(cards)).sort((a, b) => Number(a) - Number(b));
}

/** Whether the deck reads as points, so the check applies. */
export function isNumericDeck(deck: readonly string[]): boolean {
  return numericCards(deck).length > 0;
}

/**
 * The smallest card at or above `value`, else the deck's top card: an
 * expected 5.8 on Fibonacci rounds up to 8. Null on a deck that isn't
 * numeric, or for a value that isn't a number.
 */
export function cardAtOrAbove(deck: readonly string[], value: number): string | null {
  const cards = numericCards(deck);
  if (cards.length === 0 || !Number.isFinite(value)) return null;
  // A hair under, so 5 computed as 4.999… still reads as the 5 card.
  return cards.find((c) => Number(c) >= value - 1e-9) ?? cards[cards.length - 1];
}

/** Where the check starts: three cards on the deck. */
export interface ThreePointStart {
  optimistic: string;
  likely: string;
  pessimistic: string;
}

/**
 * A starting point from a revealed round: the lowest vote, the middle one
 * (the round's suggestion, ./consensus) and the highest. Only a start: the
 * votes show how far apart people are, not how unsure each one is, so the
 * host replaces them with the best, likely and worst case. Null on a deck
 * that isn't numeric, or with fewer than 2 estimates.
 */
export function threePointStart(
  votes: readonly string[],
  deck: readonly string[]
): ThreePointStart | null {
  const cards = numericCards(deck);
  if (cards.length === 0) return null;
  const played = votes.map((v) => v.trim()).filter((v) => cards.includes(v));
  if (played.length < 2) return null;
  const sorted = [...played].sort((a, b) => Number(a) - Number(b));
  // The round's suggestion, counted on the cards smallest first: the same
  // card the screen suggests, and still between the others on a custom
  // deck typed out of order.
  const likely = consensusOf(played, cards).suggested ?? sorted[0];
  return { optimistic: sorted[0], likely, pessimistic: sorted[sorted.length - 1] };
}

export type ThreePointSpread = "narrow" | "some" | "wide";

/** How wide the spread is against the expected size. */
export function threePointSpread(r: ThreePointResult): ThreePointSpread {
  if (r.expected <= 0 || r.sd === 0) return "narrow";
  const share = r.sd / r.expected;
  return share <= 0.1 ? "narrow" : share <= 0.25 ? "some" : "wide";
}

const NOTES: Record<ThreePointSpread, string> = {
  narrow: "Narrow: the three cases are close, so this size is a safe bet.",
  some: "Some uncertainty: say what would turn it into the worst case.",
  wide: "Wide: talk about the risks before you accept, or split the story.",
};

/** One sentence on what the spread means. */
export function threePointNote(r: ThreePointResult): string {
  return NOTES[threePointSpread(r)];
}

/** A figure for the screen: one decimal at most, "5.8", "6". */
export function formatPoints(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

export type ThreePointField = keyof ThreePointInput;

/** The three cases as typed (number inputs, or picked cards). */
export type ThreePointDraft = Record<ThreePointField, string>;

const LABEL: Record<ThreePointField, string> = {
  optimistic: "the best case",
  likely: "the likely case",
  pessimistic: "the worst case",
};

/**
 * The typed cases as numbers, or a message per field: each one is a
 * number from 0 to 1000, and best ≤ likely ≤ worst. An order error sits
 * on the field that breaks it (likely under best, or worst under likely).
 */
export function validateThreePoint(
  draft: ThreePointDraft
): Validation<ThreePointInput, ThreePointField> {
  const errors: Partial<Record<ThreePointField, string>> = {};
  const values: Partial<ThreePointInput> = {};
  for (const field of ["optimistic", "likely", "pessimistic"] as const) {
    const raw = (draft[field] ?? "").trim();
    if (raw === "") {
      errors[field] = `Enter ${LABEL[field]}.`;
      continue;
    }
    const n = Number(raw);
    if (!inRange(n)) {
      errors[field] = `Make ${LABEL[field]} a number from 0 to ${THREE_POINT_MAX}.`;
      continue;
    }
    values[field] = n;
  }
  const { optimistic: o, likely: m, pessimistic: p } = values;
  if (o !== undefined && m !== undefined && !errors.likely && m < o) {
    errors.likely = "The likely case can't be smaller than the best case.";
  }
  if (m !== undefined && p !== undefined && !errors.pessimistic && p < m) {
    errors.pessimistic = "The worst case can't be smaller than the likely case.";
  } else if (
    o !== undefined &&
    p !== undefined &&
    m === undefined &&
    !errors.pessimistic &&
    p < o
  ) {
    errors.pessimistic = "The worst case can't be smaller than the best case.";
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, values: values as ThreePointInput };
}
