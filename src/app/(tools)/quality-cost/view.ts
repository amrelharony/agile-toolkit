/**
 * What the Cost of Quality page shows, worked out from lib/quality/cost:
 * money and share formats, the rows of the quarter table, and the charts'
 * one-sentence summaries and tables. Pure, so the page, its Markdown export
 * and the tests read the same text.
 */

import { NO_VALUE, type ChartText } from "@/lib/charts/chart-text";
import {
  COST_CATEGORIES,
  COST_CATEGORY_LABEL,
  FAILURE_SHARE_HIGH,
  costBreakdown,
  type CostBreakdown,
  type CostCategory,
  type CostFigures,
  type FailureShareTrend,
  type QualityCostPeriod,
} from "@/lib/quality/cost";

/** "$1,234.5" for an amount; the page never shows "$0" for a figure that wasn't entered. */
export function money(n: number): string {
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/** A share (0..1) as whole percent, "42%". */
export const sharePct = (share: number) => `${Math.round(share * 100)}%`;

/** An entered amount, or "Not entered" (never $0) for a category left out. */
export const amountText = (costs: CostFigures, c: CostCategory) =>
  costs[c] === undefined ? "Not entered" : money(costs[c] as number);

/** The short category names the chart and table use. */
export const SHORT_LABEL: Record<CostCategory, string> = {
  prevention: "Prevention",
  detection: "Detection",
  internalFailure: "Internal failure",
  externalFailure: "External failure",
};

export interface PeriodRow {
  period: QualityCostPeriod;
  breakdown: CostBreakdown;
}

/** The logged quarters with their breakdowns, oldest first (as stored). */
export function periodRows(periods: readonly QualityCostPeriod[]): PeriodRow[] {
  return periods.map((period) => ({ period, breakdown: costBreakdown(period.costs) }));
}

/** Whether the failure share reads as high (the old page's "> 30%" danger tone). */
export const isHighShare = (share: number | null) => share !== null && share > FAILURE_SHARE_HIGH;

/**
 * The failure-share line: one point per logged quarter (a quarter without
 * a share is a gap), with its summary sentence and table.
 */
export function failureShareChartText(trend: FailureShareTrend): ChartText {
  const scored = trend.points.filter((p) => p.share !== null);
  const first = scored[0];
  const last = scored[scored.length - 1];
  let summary = "No quarter has a failure share yet.";
  if (first && last && first !== last) {
    const a = Math.round((first.share as number) * 100);
    const b = Math.round((last.share as number) * 100);
    summary =
      a === b
        ? `The failure share stayed at ${b}% from ${first.period} to ${last.period}.`
        : `The failure share ${b > a ? "rose" : "fell"} from ${a}% in ${first.period} to ${b}% in ${last.period}.`;
  } else if (last) {
    summary = `The failure share was ${sharePct(last.share as number)} in ${last.period}.`;
  }
  return {
    summary,
    table: {
      columns: ["Quarter", "Total", "Failure share"],
      rows: trend.points.map((p) => [
        p.period,
        money(p.total),
        p.share === null ? NO_VALUE : sharePct(p.share),
      ]),
    },
  };
}

/** The split of one quarter's spend: the slices the pie draws, its sentence and table. */
export function distributionText(
  costs: CostFigures,
  period: string
): ChartText & { slices: { category: CostCategory; name: string; value: number }[] } {
  const b = costBreakdown(costs);
  const slices = COST_CATEGORIES.filter((c) => (costs[c] ?? 0) > 0).map((c) => ({
    category: c,
    name: SHORT_LABEL[c],
    value: costs[c] as number,
  }));
  const largest = [...slices].sort((x, y) => y.value - x.value)[0];
  const summary =
    largest && b.total > 0
      ? `${largest.name} is the largest share of ${period}'s ${money(b.total)}: ${sharePct(largest.value / b.total)}.`
      : `Nothing above $0 entered for ${period}.`;
  return {
    slices,
    summary,
    table: {
      columns: ["Category", "Cost", "Share of total"],
      rows: COST_CATEGORIES.map((c) => [
        COST_CATEGORY_LABEL[c],
        amountText(costs, c),
        costs[c] === undefined || b.total === 0
          ? NO_VALUE
          : sharePct((costs[c] as number) / b.total),
      ]),
    },
  };
}
