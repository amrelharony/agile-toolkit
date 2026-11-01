/**
 * Minimum sample sizes before a statistic is shown.
 *
 * Many tools ran CUSUM, Mann-Kendall, p-charts, Holt forecasts and k-means
 * on 2–10 points, where the result is noise that reads like a finding.
 * Below these counts a tool shows `<NotEnoughData>` instead ("Log 3 more
 * sprints to see a trend"), and the advanced methods live in a collapsed
 * `<AdvancedAnalysis>` section even when they do run.
 *
 * The numbers are conservative rules of thumb, not significance tests:
 * enough points that one odd value can't flip the answer on its own.
 */
export const MIN_SAMPLE = {
  /** An average or median worth quoting. */
  average: 3,
  /** A distribution (histogram, percentile, spread). */
  distribution: 5,
  /** A direction-of-travel trend (Mann-Kendall, regression slope). */
  trend: 6,
  /** A forecast (Holt, Monte Carlo from history). */
  forecast: 4,
  /** A change-point or control-chart signal (CUSUM, p-chart rules). */
  changePoint: 8,
  /** Clustering or grouping by similarity. */
  cluster: 10,
  /** Anonymous survey results (psych safety uses its own, higher bar). */
  anonymous: 3,
  /**
   * Psych Safety's anonymous rounds. Its questions are sensitive enough
   * that three answers in a small team can point at a person, so its
   * results wait for five.
   */
  psychSafety: 5,
  /**
   * Survey responses in one week or month before its NPS or CSAT reads
   * without a warning. Below it the value still shows, with the swing one
   * answer makes (100 / n points) quoted, since a period's answers are all
   * a team has.
   */
  surveyPeriod: 10,
} as const;

export type SampleKind = keyof typeof MIN_SAMPLE;

/** True when `n` points are enough for `min` (a kind or a number). */
export function enoughData(n: number, min: SampleKind | number): boolean {
  return n >= (typeof min === "number" ? min : MIN_SAMPLE[min]);
}

/** How many more points are needed; 0 when there are enough. */
export function needMore(n: number, min: SampleKind | number): number {
  const need = typeof min === "number" ? min : MIN_SAMPLE[min];
  return Math.max(0, need - Math.max(0, Math.floor(n)));
}
