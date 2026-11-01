import { detectOutliers } from "@/lib/analytics/scoring-rubric";
import { enoughData, MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { toNumber } from "@/lib/prioritization/methods/fields";
import type { RankedRow } from "@/lib/prioritization/rank";

/** Outliers need a spread to sit outside of: a distribution's worth of scores. */
export const OUTLIER_MIN = MIN_SAMPLE.distribution;

/** The rows with a RICE score, in rank order. */
export const scoredRows = (rows: readonly RankedRow[]): RankedRow[] =>
  rows.filter((r) => r.result.score !== null);

/**
 * The scores far from the rest (1.5 × IQR), by row id, once there are
 * OUTLIER_MIN scored rows; null below that, where an "outlier" would be
 * noise that reads like a finding.
 */
export function outliersOf(rows: readonly RankedRow[]): Set<string> | null {
  const scored = scoredRows(rows);
  if (!enoughData(scored.length, OUTLIER_MIN)) return null;
  return detectOutliers(
    scored.map((r) => ({
      id: r.row.id,
      title: r.row.title,
      fields: {},
      score: r.result.score as number,
    }))
  );
}

/** A row's confidence in percent, when set. */
export const confidenceOf = (r: RankedRow): number | undefined => toNumber(r.values.confidence);
