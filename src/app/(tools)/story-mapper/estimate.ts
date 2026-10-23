import type { ScaleStep } from "@/components/shared/scale-picker";
import { defaultDescriptions, scales } from "@/lib/constants/scales";
import { fmt, listAnd, plural } from "@/lib/charts/chart-text";
import type { StoryMapSlice, StoryMapStep } from "@/lib/stores/workspace-types";
import { estimateKind, sliceCards, sliceTotals, type SliceTotals } from "@/lib/story-map/points";

// The reading of a card's estimate is shared with the Release Planner and
// the next-step rules (lib/story-map/points), so a slice totals the same
// everywhere; re-exported for this tool's modules.
export {
  estimateKind,
  estimatePoints,
  sliceCards,
  sliceTotals,
  type EstimateKind,
  type SliceTotals,
} from "@/lib/story-map/points";

/**
 * Story points on the map: the deck the editor offers, and the copy the
 * board shows. The editor only offers points from the Fibonacci deck, and
 * only a numeric estimate counts toward a slice's total; anything else is
 * shown as "custom" and kept until someone picks points.
 */

/** The Fibonacci deck Planning Poker deals by default, with what each size means. */
export const POINT_STEPS: readonly ScaleStep[] = (
  scales.find((s) => s.name === "Fibonacci")?.values ?? []
)
  .filter((v): v is number => typeof v === "number")
  .map((value) => ({ value, meaning: defaultDescriptions[String(value)] }));

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
    const count = (st: StoryMapStep) => (first.cards[st.id] ?? []).length;
    const missing = steps.filter((st) => count(st) === 0);
    let reach = "";
    if (missing.length > 0) {
      reach = `, but nothing for ${listAnd(missing.map((st) => `“${st.name}”`))} yet`;
    } else if (steps.length > 1) {
      // "One for every step" only when it is one each; more under a step still covers it.
      reach = steps.every((st) => count(st) === 1)
        ? ", one for every step"
        : ", covering every step";
    }
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
