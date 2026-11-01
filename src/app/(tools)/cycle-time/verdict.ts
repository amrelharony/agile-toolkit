import { MIN_SAMPLE, needMore } from "@/lib/analytics/min-sample";
import { fmt, plural } from "@/lib/charts/chart-text";
import type { AgeingItem } from "@/lib/flow";
import type { CycleStats } from "./helpers";

/**
 * The one-sentence answer above the charts: the service-level expectation
 * and how much of the work in progress is already past it.
 *
 *   "85% of items finish within 7 days (14 finished); 2 items in progress are already older than that."
 */
export function cycleTimeVerdict(
  stats: CycleStats,
  ageing: readonly AgeingItem[],
  sle: { pct: number; days: number | null }
): string {
  const n = stats.summary.count;
  const inProgress = ageing.length;
  if (n === 0) {
    return inProgress > 0
      ? `Nothing finished yet; ${plural(inProgress, "item")} in progress. Cycle times show once work reaches Done.`
      : "No finished items yet.";
  }
  if (!stats.distributionQuoted || sle.days === null) {
    const more = needMore(n, "distribution");
    return `Finish ${plural(more, "more item")} to set a service-level expectation (it needs ${MIN_SAMPLE.distribution}).`;
  }
  const head = `${sle.pct}% of items finish within ${plural(sle.days, "day")} (${n} finished)`;
  const late = ageing.filter((a) => a.ageDays > (sle.days as number)).length;
  if (late > 0) {
    return `${head}; ${plural(late, "item")} in progress ${late === 1 ? "is" : "are"} already older than that.`;
  }
  return inProgress > 0
    ? `${head}; none of the ${plural(inProgress, "item")} in progress is older than that yet.`
    : `${head}.`;
}

/** "5.3 days" or "—", for a statistic that may not be quoted yet. */
export const daysOrDash = (n: number | null | undefined, quoted: boolean): string =>
  quoted && n !== null && n !== undefined ? fmt(n) : "—";
