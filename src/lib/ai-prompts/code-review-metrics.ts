import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import type { CodeReviewWorkingWindow, PrSample } from "../stores/workspace-types";
import { DEFAULT_CALENDAR, type WorkingCalendar } from "../sprints/calendar";
import { MIN_SAMPLE } from "../analytics/min-sample";
import {
  reviewSummary,
  reviewTimes,
  reviewVerdict,
  sizeBandOf,
  SIZE_BANDS,
  windowMinutes,
  workingBasisLabel,
  type ReviewTimes,
} from "../quality/review";
import type { ChartTable } from "../charts/chart-text";
import {
  bandChartText,
  hoursText,
  stateText,
  weeklyChartText,
} from "@/app/(tools)/code-review-metrics/view";

/**
 * The log as the Code Review Metrics page reads it: its pull requests (the
 * team's, or the example while it is loaded), the team calendar (the
 * ceremony cadence's working days and holidays) and the log's working
 * window (unset: whole working days).
 */
interface ReviewData {
  samples: readonly PrSample[];
  calendar?: WorkingCalendar;
  workingWindow?: CodeReviewWorkingWindow | null;
}

/** The PR table lists the latest this many; the weekly table the latest this many weeks. */
const MAX_PRS = 30;
const MAX_WEEKS = 12;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const tableOf = (t: ChartTable) =>
  formatTable(
    t.columns,
    t.rows.map((r) => r.map(String))
  );

/** A PR's wait for its first review: working hours, "Waiting" while open with none, else "—". */
function firstReviewText(s: PrSample, t: ReviewTimes): string {
  if (t.reviewOutOfOrder) return "Out of order";
  if (t.toFirstReviewWorkingH !== null) return hoursText(t.toFirstReviewWorkingH);
  return t.status === "open" && !(s.firstReviewAt ?? "").trim() ? "Waiting" : "—";
}

/**
 * The review prompts with the page's numbers (lib/quality/review): the
 * median working cycle and time to first review (medians from
 * MIN_SAMPLE.average PRs, never a mean) in the team's working hours with
 * the basis they count, the elapsed medians beside them, the team view by
 * PR size (no per-author figures), the weekly median and each PR's times.
 */
export function generateCodeReviewPrompts(data: ReviewData): PromptDefinition[] {
  const { samples } = data;
  if (samples.length === 0) return [];
  const calendar = data.calendar ?? DEFAULT_CALENDAR;
  const window = windowMinutes(data.workingWindow);
  const summary = reviewSummary(samples, calendar, window);
  const h = summary.headline;
  const basis = workingBasisLabel(calendar, data.workingWindow);
  const verdict = reviewVerdict(summary);

  const counts = `${plural(summary.total, "pull request")}: ${summary.merged} merged, ${summary.open} open (${summary.awaitingReview} still waiting for a first review)${
    summary.invalid > 0 ? `, ${summary.invalid} with dates out of order (not timed)` : ""
  }.`;
  /** "6 h working (8 h elapsed)", or "—" with the PRs it needs. */
  const pair = (working: number | null, elapsed: number | null, need: string) =>
    working === null && elapsed === null
      ? `— (needs ${need})`
      : `${hoursText(working)} working (${hoursText(elapsed)} elapsed)`;
  const p85 =
    h.p85CycleWorkingH === null
      ? `— (needs ${MIN_SAMPLE.distribution} merged PRs)`
      : `${hoursText(h.p85CycleWorkingH)} working`;
  const medians = `Median time to first review: ${pair(
    h.medianFirstReviewWorkingH,
    h.medianFirstReviewH,
    `${MIN_SAMPLE.average} PRs with a first review`
  )}. Median cycle, opened to merged: ${pair(
    h.medianCycleWorkingH,
    h.medianCycleH,
    `${MIN_SAMPLE.average} merged PRs`
  )}. P85 cycle: ${p85}.`;
  const context = `Working hours count ${basis}. ${counts} ${medians}`;

  const bands = bandChartText(summary.bySize);
  const sizeBlock = `## By PR size\n\n${tableOf(bands.table)}\n\n${bands.summary} Large PRs (over ${
    SIZE_BANDS[1].maxLines
  } lines) merged with no review comment: ${summary.largeNoComments}.`;
  const weekly = weeklyChartText(summary.weekly.slice(-MAX_WEEKS));
  const weekBlock =
    summary.weekly.length === 0
      ? ""
      : `\n\n## Weekly median cycle\n\n${tableOf(weekly.table)}\n\n${weekly.summary}`;

  const prs = formatTable(
    [
      "PR",
      "Size",
      "Lines",
      "To first review (working h)",
      "Cycle (working h)",
      "Reviewers",
      "Comments",
      "Description",
    ],
    samples.slice(-MAX_PRS).map((s) => {
      const t = reviewTimes(s, calendar, window);
      const band = sizeBandOf(s.linesChanged);
      return [
        s.prNumber ?? "—",
        band ? (SIZE_BANDS.find((b) => b.id === band)?.label ?? "—") : "—",
        s.linesChanged,
        firstReviewText(s, t),
        t.status === "merged" ? hoursText(t.cycleWorkingH) : stateText(t),
        s.reviewerCount,
        s.commentCount,
        (s.description ?? "").slice(0, 60) || "—",
      ];
    })
  );
  const more =
    samples.length > MAX_PRS ? `\n(Showing the latest ${MAX_PRS} of ${samples.length} PRs)` : "";
  // PR numbers and descriptions are user-typed; authors are left out (the page reads flow, not people).
  const body = wrapUserContent(
    `Verdict: ${sanitizePromptCell(verdict, 400)}\n\n${sizeBlock}${weekBlock}\n\n## Pull requests\n\n${prs}${more}`
  );

  return [
    {
      id: "code-review-bottlenecks",
      title: "Review Bottleneck Analysis",
      description:
        "Surface where reviews are getting stuck: waiting for a first review, PR size, or specific PRs.",
      prompt:
        buildPreamble("Code Review Metrics", context) +
        `${body}\n\n## Questions\n\n1. Which PRs are outliers in cycle time relative to their size? What's the pattern?\n2. Is the wait for a first review or the time after it the bigger part of the cycle? Does review depth (comments) keep up as PRs grow?\n3. Recommend 3 process changes to compress cycle time without sacrificing review quality. Keep it about the team's review flow, not individuals.`,
    },
    {
      id: "code-review-pr-size",
      title: "PR-Size Guidance",
      description: "Use PR size and cycle time to recommend an upper-bound size policy.",
      prompt:
        buildPreamble("Code Review Metrics", context) +
        `${body}\n\n## Questions\n\n1. At what size does cycle time noticeably degrade in this dataset?\n2. Recommend a soft and hard PR-size limit, with rationale.\n3. What anti-patterns produce huge PRs, and how would you discourage them?`,
    },
  ];
}
