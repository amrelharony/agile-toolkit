import type { ScaleStep } from "@/components/shared/scale-picker";
import { defaultDescriptions, scales } from "@/lib/constants/scales";
import { fmt, listAnd, plural } from "@/lib/charts/chart-text";
import type { StoryMapCard, StoryMapSlice, StoryMapStep } from "@/lib/stores/workspace-types";

/**
 * Story points on the map.
 *
 * `StoryMapCard.estimate` stays a string in storage: Planning Poker writes
 * back whatever card the team agreed on, including a T-shirt size or "?".
 * The editor only offers points from the Fibonacci deck, and only a
 * numeric estimate counts toward a slice's total; anything else is shown
 * as "custom" and kept until someone picks points.
 */

/** The Fibonacci deck Planning Poker deals by default, with what each size means. */
export const POINT_STEPS: readonly ScaleStep[] = (
  scales.find((s) => s.name === "Fibonacci")?.values ?? []
)
  .filter((v): v is number => typeof v === "number")
  .map((value) => ({ value, meaning: defaultDescriptions[String(value)] }));

/**
 * A card's estimate as points: a finite number of zero or more, else
 * undefined (no estimate, or a "custom" one such as "XL" or "?").
 */
export function estimatePoints(estimate: string | undefined | null): number | undefined {
  if (typeof estimate !== "string" || estimate.trim() === "") return undefined;
  const n = Number(estimate);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
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
  return steps.flatMap((st) => slice.cards[st.id] ?? []);
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
  return totals;
}

/** "8 pts · 2 unestimated · 1 custom" for a slice header; "No stories" when empty. */
export function sliceSummary(t: SliceTotals): string {
  if (t.cards === 0) return "No stories";
  const parts = [`${fmt(t.points)} pts`];
  if (t.unestimated > 0) parts.push(`${t.unestimated} unestimated`);
  if (t.custom > 0) parts.push(`${t.custom} custom`);
  return parts.join(" · ");
}

/** "8 points", "8 points so far" (some cards unsized), "no points yet". */
function pointsPhrase(t: SliceTotals): string {
  if (t.estimated === 0) return "no points yet";
  const pts = plural(t.points, "point");
  return t.estimated < t.cards ? `${pts} so far` : pts;
}

/**
 * The one-sentence answer above the board: what ships first, whether that
 * first slice walks the whole journey, and how much is still unsized.
 * Slices read top to bottom in release order, so the first one is next.
 */
export function storyMapVerdict(map: {
  steps: readonly StoryMapStep[];
  slices: readonly StoryMapSlice[];
}): string {
  const { steps, slices } = map;
  const all = slices.flatMap((sl) => sliceCards(sl, steps));
  if (all.length === 0) return "No stories on the map yet.";

  const first = slices[0];
  const t = sliceTotals(first, steps);
  let lead: string;
  if (t.cards === 0) {
    lead = `“${first.name}” ships first but has no stories yet: give it one thin story per step.`;
  } else {
    const missing = steps.filter((st) => (first.cards[st.id] ?? []).length === 0);
    const reach =
      missing.length === 0
        ? steps.length > 1
          ? ", one for every step"
          : ""
        : `, but nothing for ${listAnd(missing.map((st) => `“${st.name}”`))} yet`;
    lead = `“${first.name}” ships first: ${plural(t.cards, "story", "stories")}, ${pointsPhrase(
      t
    )}${reach}.`;
  }

  const unsized = all.filter((c) => estimateKind(c.estimate) === "none").length;
  if (unsized === 0) return lead;
  return `${lead} ${unsized} of ${plural(all.length, "story", "stories")} still ${
    unsized === 1 ? "needs" : "need"
  } an estimate.`;
}
