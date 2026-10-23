/**
 * Resetting one scale of the Estimation Guide.
 *
 * "Reset to Defaults" used to put the whole guide back to its first-run
 * state, wiping the examples of every scale, with no confirm and no undo.
 * A reset now covers the scale on screen only: its descriptions go back to
 * the built-in ones, and its team examples and reference stories are
 * cleared. Undo restores exactly those keys, so an edit made on another
 * scale in the meantime survives.
 */

import type { EstimationScale } from "@/lib/constants/scales";
import { defaultDescription, entryKey, readEntry } from "./entries";
import { pinnedIds, type GuideEntries } from "./references";

/** The three per-value maps a scale's reset touches. */
export type ScaleMaps = GuideEntries;

/** Whether the scale reads as the built-in guide: default meanings, no examples, no pins. */
export function isScaleAtDefaults(maps: ScaleMaps, scale: EstimationScale): boolean {
  return scale.values.every(
    (v) =>
      readEntry(maps.descriptions ?? {}, scale.name, v, defaultDescription(v)) ===
        defaultDescription(v) &&
      readEntry(maps.examples ?? {}, scale.name, v).trim() === "" &&
      pinnedIds(maps.referenceStoryIds, scale.name, v).length === 0
  );
}

/**
 * The maps with `scale` back to the built-in guide. A legacy bare key ("8",
 * from before per-scale keys) would show through a deleted entry, so the
 * scale's example is set to "" where one exists instead of deleted.
 */
export function withScaleReset(maps: ScaleMaps, scale: EstimationScale): ScaleMaps {
  const descriptions = { ...(maps.descriptions ?? {}) };
  const examples = { ...(maps.examples ?? {}) };
  const referenceStoryIds = { ...(maps.referenceStoryIds ?? {}) };
  for (const v of scale.values) {
    const key = entryKey(scale.name, v);
    descriptions[key] = defaultDescription(v);
    if (typeof examples[String(v)] === "string") examples[key] = "";
    else delete examples[key];
    delete referenceStoryIds[key];
  }
  return { descriptions, examples, referenceStoryIds };
}

function restoreKeys<T>(
  current: Record<string, T>,
  before: Record<string, T>,
  keys: readonly string[]
): Record<string, T> {
  const next = { ...current };
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(before, key)) next[key] = before[key];
    else delete next[key];
  }
  return next;
}

/** Undo for `withScaleReset`: `scale`'s keys as they were in `before`; every other key as it is now. */
export function restoreScale(
  current: ScaleMaps,
  before: ScaleMaps,
  scale: EstimationScale
): ScaleMaps {
  const keys = scale.values.map((v) => entryKey(scale.name, v));
  return {
    descriptions: restoreKeys(current.descriptions ?? {}, before.descriptions ?? {}, keys),
    examples: restoreKeys(current.examples ?? {}, before.examples ?? {}, keys),
    referenceStoryIds: restoreKeys(
      current.referenceStoryIds ?? {},
      before.referenceStoryIds ?? {},
      keys
    ),
  };
}
