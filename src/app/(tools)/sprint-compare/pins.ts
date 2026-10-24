"use client";

/**
 * Which shared sprints Sprint Comparison shows side by side (up to five).
 *
 * The list is this tool's own, kept in this browser by lib/sprints/
 * compare-pins (a plain JSON array of sprint ids, the format the legacy
 * migration seeds). With nothing stored, the tool shows the newest scored
 * sprints, so the list follows the data until the user pins or unpins
 * something.
 */

import { useMemo } from "react";
import type { Sprint, SprintSeries } from "@/lib/stores/workspace-types";
import { seriesFor } from "@/lib/sprints/series";
import {
  COMPARE_PINS_KEY,
  clearComparePins,
  parseComparePins,
  readComparePins,
  useStoredComparePins,
  writeComparePins,
} from "@/lib/sprints/compare-pins";

// One definition, shared with the migration that seeds it.
export const PINS_KEY = COMPARE_PINS_KEY;
export const MAX_PINS = 5;
/** How many unscored sprints the default shows when nothing has a score yet. */
const DEFAULT_UNSCORED_PINS = 3;

export {
  clearComparePins as clearPins,
  parseComparePins as parsePins,
  readComparePins as readPins,
  writeComparePins as writePins,
};

/** True when the sprint has at least one typed rating. */
export function hasRatings(series: SprintSeries | undefined): boolean {
  return Object.values(series?.ratings ?? {}).some((v) => Number.isFinite(v));
}

/**
 * The default comparison: the five newest sprints with a score, else the
 * three newest sprints. `sprints` must be newest first. "Has a score" is
 * `hasScore` (the page passes: any of the six is scored); without it, a
 * typed rating.
 */
export function defaultPins(
  sprints: readonly Sprint[],
  series: readonly SprintSeries[] | undefined,
  hasScore: (s: Sprint) => boolean = (s) => hasRatings(seriesFor(series, s.id))
): string[] {
  const scored = sprints.filter(hasScore);
  const pick =
    scored.length > 0 ? scored.slice(0, MAX_PINS) : sprints.slice(0, DEFAULT_UNSCORED_PINS);
  return pick.map((s) => s.id);
}

/**
 * The pins to show: the stored ids whose sprint still exists (in stored
 * order, no repeats, at most five), or the default when nothing is stored.
 */
export function resolvePins(
  stored: readonly string[] | null,
  sprints: readonly Sprint[],
  series: readonly SprintSeries[] | undefined,
  hasScore?: (s: Sprint) => boolean
): string[] {
  if (stored === null) return defaultPins(sprints, series, hasScore);
  const existing = new Set(sprints.map((s) => s.id));
  const out: string[] = [];
  for (const id of stored) {
    if (existing.has(id) && !out.includes(id)) out.push(id);
    if (out.length >= MAX_PINS) break;
  }
  return out;
}

export interface ComparePins {
  /** Pinned sprint ids, resolved against the sprints that exist. */
  pins: string[];
  /** True when nothing is stored and `pins` is the default list. */
  isDefault: boolean;
}

/** The pinned sprints, following storage (this tab and others). `sprints` newest first. */
export function useComparePins(
  sprints: readonly Sprint[],
  series: readonly SprintSeries[] | undefined,
  hasScore?: (s: Sprint) => boolean
): ComparePins {
  const stored = useStoredComparePins();
  const pins = useMemo(
    () => resolvePins(stored, sprints, series, hasScore),
    [stored, sprints, series, hasScore]
  );
  return { pins, isDefault: stored === null };
}
