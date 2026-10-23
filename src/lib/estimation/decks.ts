/**
 * Planning Poker's decks, built from the Estimation Guide's scales
 * (lib/constants/scales) so the two tools share one list of values. Poker
 * adds its "can't estimate" cards: "?" and, on Fibonacci, "∞" for too big.
 *
 * In lib rather than the tool folder so the tool.planning_poker.* agent
 * actions use the same decks as the page. The result is the deck sessions
 * have always used, so a stored or broadcast session (which carries its own
 * `scale`) reads the same.
 */

import { scales } from "@/lib/constants/scales";

/** Part of the session payload: guests on any build validate it against these three. */
export type ScaleType = "fibonacci" | "tshirt" | "custom";

/** The Estimation Guide's scale each deck is built from. */
export const GUIDE_SCALE: Record<Exclude<ScaleType, "custom">, string> = {
  fibonacci: "Fibonacci",
  tshirt: "T-Shirt",
};

/** A guide scale's values as cards. */
export function cardsOf(name: string): string[] {
  return (scales.find((s) => s.name === name)?.values ?? []).map(String);
}

export const SCALES: Record<ScaleType, string[]> = {
  fibonacci: [...cardsOf(GUIDE_SCALE.fibonacci), "?", "∞"],
  tshirt: [...cardsOf(GUIDE_SCALE.tshirt), "?"],
  custom: [],
};

export const SCALE_LABELS: Record<ScaleType, string> = {
  fibonacci: GUIDE_SCALE.fibonacci,
  tshirt: GUIDE_SCALE.tshirt,
  custom: "Custom",
};

/** The lobby's starting custom deck: the guide's Powers of 2. */
export const DEFAULT_CUSTOM_DECK = cardsOf("Powers of 2").join(", ");
