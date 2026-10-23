import type { PrioritizationItem } from "@/lib/stores/workspace-types";
import { fmt, listAnd } from "@/lib/charts/chart-text";

/** At or below this, the top idea is still a guess (contract item 7: say so). */
const LOW_CONFIDENCE = 3;

const confidenceOf = (x: PrioritizationItem) => {
  const n = Number(x.fields?.confidence);
  return Number.isFinite(n) ? n : null;
};

/**
 * The one-sentence answer above the list: what to do first, ties named,
 * and a warning when the front-runner rests on a hunch.
 */
export function iceVerdict(items: readonly PrioritizationItem[]): string {
  if (items.length === 0) return "No ideas scored yet.";
  const best = Math.max(...items.map((x) => x.score ?? 0));
  const top = items.filter((x) => (x.score ?? 0) === best);
  const names = listAnd(top.map((x) => `“${x.title}”`));
  const lead =
    top.length === 1
      ? `Do first: ${names} (ICE ${fmt(best)}).`
      : `Do first: ${names} tie at ICE ${fmt(best)}.`;
  const shaky = top.filter((x) => (confidenceOf(x) ?? 10) <= LOW_CONFIDENCE);
  if (shaky.length === 0) return lead;
  return `${lead} Confidence is low, so test ${top.length === 1 ? "it" : "them"} cheaply before building.`;
}
