/**
 * Sprint Comparison's view of the shared sprints: the pinned sprints in
 * comparison order, each with its six scores from lib/sprints/compare
 * (computed from the sprint's data, prefilled from Mood Tracker and the
 * Squad Health Check, or rated by the team). A dimension with nothing to go
 * on is not scored, never a default.
 */

import type { Sprint } from "@/lib/stores/workspace-types";
import { CHART_COLORS } from "@/components/charts/chart-theme";
import {
  MAX_SCORE,
  MIN_SCORE,
  averageScore,
  isFinishedSprint,
  sprintScores,
  type CompareInput,
  type SprintScores,
} from "@/lib/sprints/compare";
import { SPRINT_RATING_DIMENSIONS, type SprintRatingDimension } from "@/lib/sprints/series";

export { isFinishedSprint };

export const DIMENSIONS = SPRINT_RATING_DIMENSIONS;
export type Dimension = SprintRatingDimension;

/** Series colours, by position in the comparison: theme tokens. */
export const SERIES_COLORS = CHART_COLORS.slice(0, 5);

/** A sprint being rated that isn't in the comparison. */
export const UNPINNED_COLOR = "var(--sub)";

export const MIN_RATING = MIN_SCORE;
export const MAX_RATING = MAX_SCORE;

/** Everything a score is read from, apart from the sprint itself. */
export type CompareSources = Omit<CompareInput, "sprint" | "sprints">;

export interface CompareRow {
  id: string;
  name: string;
  sprint: Sprint;
  scores: SprintScores;
  /** averageScore(scores): the number the cockpit's "Average rating" tile shows. */
  average: number | null;
  color: string;
}

/** The six scores of every sprint, by id. */
export function scoresBySprint(
  sprints: readonly Sprint[],
  sources: CompareSources
): Map<string, SprintScores> {
  return new Map(sprints.map((s) => [s.id, sprintScores({ ...sources, sprint: s, sprints })]));
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
  scores: ReadonlyMap<string, SprintScores>
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
  return pinned.flatMap(({ sprint }, i) => {
    const s = scores.get(sprint.id);
    if (!s) return [];
    return [
      {
        id: sprint.id,
        name: sprint.name,
        sprint,
        scores: s,
        average: averageScore(s),
        color: SERIES_COLORS[i % SERIES_COLORS.length],
      },
    ];
  });
}

/** One radar row per dimension; each sprint's score keyed by its id (null when not scored). */
export function radarData(rows: readonly CompareRow[]): Record<string, string | number | null>[] {
  return DIMENSIONS.map((dim) => {
    const entry: Record<string, string | number | null> = { dimension: dim };
    for (const row of rows) entry[row.id] = row.scores[dim].value;
    return entry;
  });
}

/** The scored values only, for the AI prompts (an unscored dimension is absent, not 0). */
export function scoredValues(scores: SprintScores): Partial<Record<Dimension, number>> {
  const out: Partial<Record<Dimension, number>> = {};
  for (const dim of DIMENSIONS) {
    const v = scores[dim].value;
    if (v !== null) out[dim] = v;
  }
  return out;
}

/** "29 of 34 points" for a finished sprint, else null (a running sprint's typed points don't count). */
export function pointsDone(
  sprint: Pick<Sprint, "pointsCompleted" | "pointsPlanned" | "status">
): string | null {
  if (!isFinishedSprint(sprint)) return null;
  return sprint.pointsPlanned > 0
    ? `${sprint.pointsCompleted} of ${sprint.pointsPlanned} points`
    : `${sprint.pointsCompleted} points`;
}
