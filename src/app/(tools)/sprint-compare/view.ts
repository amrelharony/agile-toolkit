/**
 * Sprint Comparison's view of the shared sprints: the pinned sprints in
 * comparison order, with their ratings (only the dimensions the tool rates;
 * a dimension nobody rated is absent, never a default score).
 */

import type { Sprint, SprintSeries } from "@/lib/stores/workspace-types";
import {
  SPRINT_RATING_DIMENSIONS,
  seriesFor,
  type SprintRatingDimension,
} from "@/lib/sprints/series";

export const DIMENSIONS = SPRINT_RATING_DIMENSIONS;
export type Dimension = SprintRatingDimension;
export type Ratings = Partial<Record<Dimension, number>>;

/** Series colours, by position in the comparison. */
export const CHART_COLORS = ["#00f0ff", "#ff00aa", "#00ff88", "#ffaa00", "#8b5cf6"] as const;

export const MIN_RATING = 1;
export const MAX_RATING = 10;

export interface CompareRow {
  id: string;
  name: string;
  sprint: Sprint;
  ratings: Ratings;
  color: string;
}

/** The rated dimensions of a series (finite numbers only). */
export function ratingsOf(series: SprintSeries | undefined): Ratings {
  const out: Ratings = {};
  for (const dim of DIMENSIONS) {
    const v = series?.ratings?.[dim];
    if (typeof v === "number" && Number.isFinite(v)) out[dim] = v;
  }
  return out;
}

/** Mean of the rated dimensions to one decimal, or null when none are rated. */
export function averageOf(ratings: Ratings): number | null {
  const values = DIMENSIONS.map((d) => ratings[d]).filter(
    (v): v is number => typeof v === "number"
  );
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

/** A typed rating clamped to 1-10 and rounded to one decimal. */
export function clampRating(n: number): number {
  return Math.round(Math.min(MAX_RATING, Math.max(MIN_RATING, n)) * 10) / 10;
}

const isoDay = (s: Sprint): string | null => {
  const m = /^\d{4}-\d{2}-\d{2}/.exec(s.startDate ?? "");
  return m ? m[0] : null;
};

/**
 * The pinned sprints, oldest first so trends read left to right. Sprints
 * without a start date (rows the migration brought over from the old
 * free-text tool) come first, in pin order.
 */
export function buildRows(
  pins: readonly string[],
  sprints: readonly Sprint[],
  series: readonly SprintSeries[] | undefined
): CompareRow[] {
  const byId = new Map(sprints.map((s) => [s.id, s]));
  const pinned = pins
    .map((id, index) => ({ sprint: byId.get(id), index }))
    .filter((p): p is { sprint: Sprint; index: number } => p.sprint !== undefined);
  pinned.sort((a, b) => {
    const da = isoDay(a.sprint);
    const db = isoDay(b.sprint);
    if (da === null || db === null) {
      if (da !== db) return da === null ? -1 : 1;
      return a.index - b.index;
    }
    return da === db ? a.index - b.index : da < db ? -1 : 1;
  });
  return pinned.map(({ sprint }, i) => ({
    id: sprint.id,
    name: sprint.name,
    sprint,
    ratings: ratingsOf(seriesFor(series, sprint.id)),
    color: CHART_COLORS[i % CHART_COLORS.length],
  }));
}

/** One radar row per dimension; each sprint's rating keyed by its id (null when not rated). */
export function radarData(rows: readonly CompareRow[]): Record<string, string | number | null>[] {
  return DIMENSIONS.map((dim) => {
    const entry: Record<string, string | number | null> = { dimension: dim };
    for (const row of rows) entry[row.id] = row.ratings[dim] ?? null;
    return entry;
  });
}

/** "29 of 34 points" for a sprint with completed points, else null. */
export function pointsDone(
  sprint: Pick<Sprint, "pointsCompleted" | "pointsPlanned">
): string | null {
  if (typeof sprint.pointsCompleted !== "number" || !Number.isFinite(sprint.pointsCompleted)) {
    return null;
  }
  return sprint.pointsPlanned > 0
    ? `${sprint.pointsCompleted} of ${sprint.pointsPlanned} points`
    : `${sprint.pointsCompleted} points`;
}
