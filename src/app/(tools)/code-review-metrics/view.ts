/**
 * What the Code Review Metrics page shows, worked out from
 * lib/quality/review: hours wording, a PR's state, and the team-level
 * charts' summaries and tables. Pure, so the page, the Markdown export and
 * the tests read the same text. There is no per-author view on purpose: the
 * page reads review flow by PR size, not people.
 */

import { NO_VALUE, plural, type ChartText } from "@/lib/charts/chart-text";
import { needMore, type SampleKind } from "@/lib/analytics/min-sample";
import { periodLabel } from "@/lib/analytics/periods";
import {
  formatReviewHours,
  type ReviewBand,
  type ReviewSummary,
  type ReviewTimes,
} from "@/lib/quality/review";

/** "3.5 h", or "—" for a number not worth quoting. */
export const hoursText = (h: number | null) =>
  h === null ? NO_VALUE : `${formatReviewHours(h)} h`;

/**
 * What a KPI under its minimum sample (`kind`) still needs, as a full
 * clause with the right plural: "Log 1 more merged PR to see it".
 */
export const moreToSee = (count: number, kind: SampleKind, [one, many]: [string, string]) =>
  `Log ${plural(needMore(count, kind), `more ${one}`, `more ${many}`)} to see it`;

/** A stored wall-clock time as people read it: "16 Oct, 16:30". */
export function whenText(value: string | undefined): string {
  if (!value) return NO_VALUE;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(value);
  if (!m) return value;
  const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
  return m[4] ? `${day}, ${m[4]}:${m[5]}` : day;
}

/** A PR's state in the list: its working cycle, "open", or that its dates are out of order. */
export function stateText(t: ReviewTimes): string {
  if (t.status === "invalid") return "Dates out of order";
  if (t.status === "open") return "Open";
  return `${hoursText(t.cycleWorkingH)} working`;
}

/** The PR-size view: the band whose merges are slowest, and a row per band. */
export function bandChartText(bands: readonly ReviewBand[]): ChartText {
  const timed = bands.filter((b) => b.medianCycleWorkingH !== null);
  const slowest = [...timed].sort(
    (a, b) => (b.medianCycleWorkingH as number) - (a.medianCycleWorkingH as number)
  )[0];
  return {
    summary:
      timed.length === 0
        ? "No PR size has enough merges for a median yet."
        : timed.length === 1
          ? `${slowest.label}: half merge within ${hoursText(slowest.medianCycleWorkingH)} of working time.`
          : `${slowest.label} take longest to merge: half within ${hoursText(slowest.medianCycleWorkingH)} of working time.`,
    table: {
      columns: [
        "PR size",
        "PRs",
        "Merged",
        "Median first review (working h)",
        "Median cycle (working h)",
        "Median comments",
      ],
      rows: bands.map((b) => [
        b.label,
        b.n,
        b.merged,
        b.medianFirstReviewWorkingH === null
          ? NO_VALUE
          : formatReviewHours(b.medianFirstReviewWorkingH),
        b.medianCycleWorkingH === null ? NO_VALUE : formatReviewHours(b.medianCycleWorkingH),
        b.medianComments ?? NO_VALUE,
      ]),
    },
  };
}

/** The weekly median line: first and last week with a median, and a row per week. */
export function weeklyChartText(weekly: ReviewSummary["weekly"]): ChartText {
  const timed = weekly.filter((w) => w.medianCycleWorkingH !== null);
  const first = timed[0];
  const last = timed[timed.length - 1];
  let summary = "No week has enough merges for a median yet.";
  if (first && last && first !== last) {
    const a = formatReviewHours(first.medianCycleWorkingH as number);
    const b = formatReviewHours(last.medianCycleWorkingH as number);
    summary =
      a === b
        ? `The weekly median stayed at ${a} working hours from ${periodLabel(first.week)} to ${periodLabel(last.week)}.`
        : `The weekly median ${Number(b) > Number(a) ? "rose" : "fell"} from ${a} working hours in ${periodLabel(first.week)} to ${b} in ${periodLabel(last.week)}.`;
  } else if (last) {
    summary = `One week with enough merges: a median of ${formatReviewHours(last.medianCycleWorkingH as number)} working hours in ${periodLabel(last.week)}.`;
  }
  return {
    summary,
    table: {
      columns: ["Week", "Merged", "Median cycle (working h)"],
      rows: weekly.map((w) => [
        periodLabel(w.week),
        w.n,
        w.medianCycleWorkingH === null ? NO_VALUE : formatReviewHours(w.medianCycleWorkingH),
      ]),
    },
  };
}

export interface ScatterPoint {
  label: string;
  linesChanged: number;
  cycleWorkingH: number;
}

/** PR size against working cycle hours: how many points, and a row each. */
export function scatterText(points: readonly ScatterPoint[]): ChartText {
  return {
    summary:
      points.length === 0
        ? "No merged pull requests yet."
        : `${plural(points.length, "merged pull request")} by size and working hours to merge.`,
    table: {
      columns: ["PR", "Lines changed", "Cycle (working h)"],
      rows: points.map((p) => [p.label, p.linesChanged, formatReviewHours(p.cycleWorkingH)]),
    },
  };
}
