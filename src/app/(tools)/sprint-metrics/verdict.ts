/**
 * The trend in one sentence, from the same summary as the charts: how often
 * the team met its commitment, what it carried over and how much its scope
 * changed mid-sprint. Null below MIN_SAMPLE.average finished sprints, where
 * the page says how many more to close instead.
 */

import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { fmt } from "@/lib/charts/chart-text";
import type { SprintTrendSummary } from "@/lib/sprints/trends";

const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);

export function trendVerdict(summary: SprintTrendSummary): string | null {
  const n = summary.rows.length;
  if (n < MIN_SAMPLE.average) return null;
  const over = `Over the last ${n} sprints`;
  const { sayDo, carryOver, churn } = summary;
  const parts: string[] = [];
  parts.push(
    sayDo.considered === 0
      ? "no sprint had a commitment to meet"
      : sayDo.met === 0
        ? "the team never met its commitment"
        : `the team met its commitment ${times(sayDo.met)}${
            sayDo.considered < n ? ` (of ${sayDo.considered} with one)` : ""
          }`
  );
  if (carryOver.meanPoints !== null) {
    parts.push(`carried over ${fmt(carryOver.meanPoints)} points a sprint`);
  }
  if (churn.meanPct !== null) {
    parts.push(`changed ${churn.meanPct}% of its scope mid-sprint`);
  }
  const list =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `${over} ${list}.`;
}
