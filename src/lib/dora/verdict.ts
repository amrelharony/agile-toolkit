/**
 * The DORA Scorecard's one-sentence answer over its latest quarter: the
 * weakest metric and its band, and how the rest compare. The page shows it,
 * the Markdown export and tool.dora_scorecard.list_state quote it.
 */

import type { DoraSample } from "@/lib/stores/workspace-types";
import { DORA_METRICS, DORA_METRIC_LABEL, bandRank, formatMetric, type DoraBand } from "./bands";
import { latestSample, sampleBands, weakestMetrics } from "./samples";

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

const listAnd = (parts: string[]) =>
  parts.length <= 1
    ? parts.join("")
    : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

const COUNT = ["", "one", "two", "three", "four"];

/**
 *   "2026-Q3: lead time is the weakest (Medium, 5 days); the other three are High or better."
 *   "2026-Q3: all four metrics are Elite."
 *   "No quarters logged yet."
 */
export function doraVerdict(samples: readonly DoraSample[]): string {
  const latest = latestSample(samples);
  if (!latest) return "No quarters logged yet.";
  const bands = sampleBands(latest);
  const { metrics, band } = weakestMetrics(latest);
  if (!band || metrics.length === 0) return `${latest.quarter}: no metric has a band yet.`;
  const banded = DORA_METRICS.filter((m) => bands[m] !== null);
  if (metrics.length === banded.length) {
    return banded.length === 4
      ? `${latest.quarter}: all four metrics are ${band}.`
      : `${latest.quarter}: every banded metric is ${band}.`;
  }
  const others = banded.filter((m) => !metrics.includes(m));
  const otherWorst = others.reduce<DoraBand>(
    (worst, m) => (bandRank(bands[m]!) > bandRank(worst) ? bands[m]! : worst),
    "Elite"
  );
  const rest =
    otherWorst === "Elite"
      ? others.length === 1
        ? "the other is Elite"
        : `the other ${COUNT[others.length]} are Elite`
      : others.length === 1
        ? `the other is ${otherWorst} or better`
        : `the other ${COUNT[others.length]} are ${otherWorst} or better`;
  const names = metrics.map((m) => lower(DORA_METRIC_LABEL[m]));
  const weakest =
    metrics.length === 1
      ? `${names[0]} is the weakest (${band}, ${formatMetric(metrics[0], latest[metrics[0]])})`
      : `${listAnd(names)} are the weakest (${band})`;
  return `${latest.quarter}: ${weakest}; ${rest}.`;
}
