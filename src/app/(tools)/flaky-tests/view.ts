/**
 * What the Flaky Test Scoreboard shows, worked out from lib/quality/flaky:
 * a test's rate as "failures of runs", its quarantine note, the order of
 * the list, and the charts' summaries and tables. Pure, so the page, the
 * Markdown export and the tests read the same text.
 */

import { NO_VALUE, plural, type ChartText } from "@/lib/charts/chart-text";
import { periodLabel } from "@/lib/analytics/periods";
import {
  FLAKY_STATUS_LABEL,
  flakyRate,
  hasRunCounts,
  quarantinedDays,
  ratePercent,
  type FlakyOffender,
} from "@/lib/quality/flaky";
import type { FlakyStatus, FlakyTest } from "@/lib/stores/workspace-types";

/** "3 of 40 runs (7.5%)", or a legacy row's bare rate. */
export function rateText(t: FlakyTest): string {
  const rate = flakyRate(t);
  if (hasRunCounts(t)) {
    return `${t.failures} of ${t.runs} ${t.runs === 1 ? "run" : "runs"} (${ratePercent(rate as number)})`;
  }
  return rate === null ? "No rate" : `${ratePercent(rate)} (no run counts)`;
}

/** "Quarantined 23 days", "Quarantined today", or "Quarantined (date unknown)" for a legacy row. */
export function quarantineText(t: FlakyTest, today: string): string | null {
  if (t.status !== "quarantined") return null;
  const days = quarantinedDays(t, today);
  if (days === null) return "Quarantined (date unknown)";
  if (days === 0) return "Quarantined today";
  return `Quarantined ${plural(days, "day")}`;
}

export type SortKey = "rate" | "name" | "status" | "firstSeen";

export const SORT_LABEL: Record<SortKey, string> = {
  rate: "Highest failure rate",
  name: "Name",
  status: "Status",
  firstSeen: "Newest first",
};

const STATUS_ORDER: Record<FlakyStatus, number> = { active: 0, quarantined: 1, fixed: 2 };

/** The list's order for a sort; ties go by name so the order is stable. */
export function compareTests(key: SortKey): (a: FlakyTest, b: FlakyTest) => number {
  const byName = (a: FlakyTest, b: FlakyTest) => a.name.localeCompare(b.name);
  switch (key) {
    case "rate":
      return (a, b) => (flakyRate(b) ?? -1) - (flakyRate(a) ?? -1) || byName(a, b);
    case "status":
      return (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || byName(a, b);
    case "firstSeen":
      return (a, b) =>
        (a.firstSeenAt < b.firstSeenAt ? 1 : a.firstSeenAt > b.firstSeenAt ? -1 : 0) ||
        byName(a, b);
    default:
      return byName;
  }
}

/** The worst offenders' bars: their sentence and table. */
export function offendersChartText(offenders: readonly FlakyOffender[]): ChartText {
  const worst = offenders[0];
  return {
    summary: worst
      ? `${worst.name} fails most often: ${ratePercent(worst.failureRate)}${
          worst.runs !== null ? ` of ${worst.runs} runs` : ""
        }${worst.fewRuns ? ", from few runs" : ""}.`
      : "No open flaky tests.",
    table: {
      columns: ["Test", "Status", "Failures", "Runs", "Failure rate"],
      rows: offenders.map((o) => [
        o.name,
        FLAKY_STATUS_LABEL[o.status],
        o.failures ?? NO_VALUE,
        o.runs ?? NO_VALUE,
        ratePercent(o.failureRate),
      ]),
    },
  };
}

/** New flaky tests per week: the busiest week and the table. */
export function weeklyChartText(weeks: readonly { week: string; count: number }[]): ChartText {
  const total = weeks.reduce((a, w) => a + w.count, 0);
  const busiest = [...weeks].sort((a, b) => b.count - a.count)[0];
  return {
    summary:
      busiest && total > 0
        ? `${plural(total, "flaky test")} first seen over ${plural(weeks.length, "week")}; the most, ${busiest.count}, in ${periodLabel(busiest.week)}.`
        : "No flaky tests with a first-seen day.",
    table: {
      columns: ["Week", "New flaky tests"],
      rows: weeks.map((w) => [periodLabel(w.week), w.count]),
    },
  };
}
