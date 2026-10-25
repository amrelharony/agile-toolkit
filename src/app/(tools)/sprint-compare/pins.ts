"use client";

/**
 * Which shared sprints Sprint Comparison shows side by side (up to five).
 *
 * The list is this tool's own, kept in this browser by lib/sprints/
 * compare-pins (a plain JSON array of sprint ids, the format the legacy
 * migration seeds). With nothing stored, the tool shows the newest
 * finished sprints (lib/sprints/compare defaultComparedIds, which
 * `tool.sprint_compare.list_state` uses too), so the list follows the data
 * until the user pins or unpins something.
 */

import { useMemo } from "react";
import type { Sprint, SprintSeries } from "@/lib/stores/workspace-types";
import { seriesFor } from "@/lib/sprints/series";
import { MAX_COMPARED, defaultComparedIds } from "@/lib/sprints/compare";
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
export const MAX_PINS = MAX_COMPARED;

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
 * The default comparison: the five newest sprints that pass `include`,
 * else the three newest sprints. `sprints` must be newest first. The page
 * passes "finished" (isFinishedSprint), so a rating can't change which
 * sprints are compared; without it, a typed rating.
 */
export function defaultPins(
  sprints: readonly Sprint[],
  series: readonly SprintSeries[] | undefined,
  include: (s: Sprint) => boolean = (s) => hasRatings(seriesFor(series, s.id))
): string[] {
  return defaultComparedIds(sprints, include);
}

/**
 * The pins to show: the stored ids whose sprint still exists (in stored
 * order, no repeats, at most five), or the default when nothing is stored.
 */
export function resolvePins(
  stored: readonly string[] | null,
  sprints: readonly Sprint[],
  series: readonly SprintSeries[] | undefined,
  include?: (s: Sprint) => boolean
): string[] {
  if (stored === null) return defaultPins(sprints, series, include);
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
  include?: (s: Sprint) => boolean
): ComparePins {
  const stored = useStoredComparePins();
  const pins = useMemo(
    () => resolvePins(stored, sprints, series, include),
    [stored, sprints, series, include]
  );
  return { pins, isDefault: stored === null };
}
