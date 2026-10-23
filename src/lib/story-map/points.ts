/**
 * Story points on the story map: one reading, shared by the Story Mapper
 * (card badges, slice totals), the Release Planner (a slice as release
 * scope) and the next-step rules, so a slice's total is the same number
 * wherever it shows.
 *
 * `StoryMapCard.estimate` stays a string in storage: Planning Poker writes
 * back whatever card the team agreed on, including a T-shirt size or "?".
 * Only a plain number of zero or more counts as points — "5", "0.5",
 * "0,5", "½", "8 pts"; anything else ("XL", "?", "0x10", "1e3") is kept
 * and shown as a custom estimate, never summed.
 */

import type { StoryMapCard, StoryMapSlice, StoryMapStep } from "@/lib/stores/workspace-types";

/** A card's estimate as points, else undefined (no estimate, or a custom one). */
export function estimatePoints(estimate: string | undefined | null): number | undefined {
  if (typeof estimate !== "string") return undefined;
  const raw = estimate.trim();
  if (raw === "½") return 0.5;
  const m = /^(\d+(?:[.,]\d+)?)\s*(?:pts?|points?|sp)?$/i.exec(raw);
  if (!m) return undefined;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

/** How a card is estimated: in points, with a custom value, or not at all. */
export type EstimateKind = "points" | "custom" | "none";

export function estimateKind(estimate: string | undefined | null): EstimateKind {
  if (estimatePoints(estimate) !== undefined) return "points";
  return typeof estimate === "string" && estimate.trim() !== "" ? "custom" : "none";
}

/** The cards of a slice that sit under today's steps, in step order. */
export function sliceCards(slice: StoryMapSlice, steps: readonly StoryMapStep[]): StoryMapCard[] {
  // A key for a removed step (an older or hand-edited map) isn't on the board.
  return steps.flatMap((st) => slice.cards?.[st.id] ?? []);
}

export interface SliceTotals {
  cards: number;
  /** Sum of the numeric estimates. */
  points: number;
  /** Cards estimated in points. */
  estimated: number;
  /** Cards with no estimate at all. */
  unestimated: number;
  /** Cards with a non-numeric estimate: kept, shown, never summed. */
  custom: number;
}

export function sliceTotals(slice: StoryMapSlice, steps: readonly StoryMapStep[]): SliceTotals {
  const totals: SliceTotals = { cards: 0, points: 0, estimated: 0, unestimated: 0, custom: 0 };
  for (const card of sliceCards(slice, steps)) {
    totals.cards++;
    const kind = estimateKind(card.estimate);
    if (kind === "points") {
      totals.points += estimatePoints(card.estimate) as number;
      totals.estimated++;
    } else if (kind === "custom") totals.custom++;
    else totals.unestimated++;
  }
  totals.points = Math.round(totals.points * 10) / 10;
  return totals;
}
