import type { Story } from "@/lib/stores/workspace-types";
import type { EstimationScale } from "@/lib/constants/scales";
import { listAnd } from "@/lib/charts/chart-text";
import { readEntry } from "./entries";
import { pinnedIds, resolveReferenceStories, type GuideEntries } from "./references";

export interface GuideCoverage {
  scale: string;
  values: number;
  /** Cards with a team example or at least one reference story that still exists. */
  calibrated: number;
  /** The cards with neither, in scale order. */
  missing: string[];
}

/**
 * How much of the scale is in the team's own terms. The built-in meanings
 * don't count: they are the same for every team, and the point of the
 * guide is what an 8 means here.
 */
export function guideCoverage(
  maps: GuideEntries,
  scale: EstimationScale,
  stories: readonly Story[]
): GuideCoverage {
  const missing: string[] = [];
  for (const v of scale.values) {
    const example = readEntry(maps.examples ?? {}, scale.name, v).trim();
    const pins = resolveReferenceStories(pinnedIds(maps.referenceStoryIds, scale.name, v), stories);
    if (!example && pins.length === 0) missing.push(String(v));
  }
  return {
    scale: scale.name,
    values: scale.values.length,
    calibrated: scale.values.length - missing.length,
    missing,
  };
}

/** The one-sentence answer above the cards: is the scale calibrated, and what's left. */
export function guideVerdict(c: GuideCoverage): string {
  const where = `on the ${c.scale} scale`;
  if (c.values === 0) return `The ${c.scale} scale has no cards.`;
  if (c.calibrated === c.values)
    return `Every card ${where} has a team example or a reference story.`;
  if (c.calibrated === 0)
    return `No card ${where} has a team example or a reference story yet: start with the cards your team plays most.`;
  return `${c.calibrated} of ${c.values} cards ${where} have a team example or a reference story; still to do: ${listAnd(c.missing)}.`;
}
