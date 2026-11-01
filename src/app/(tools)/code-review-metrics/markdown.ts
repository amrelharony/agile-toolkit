import { NO_VALUE } from "@/lib/charts/chart-text";
import {
  reviewSummary,
  reviewTimes,
  reviewVerdict,
  windowMinutes,
  workingBasisLabel,
} from "@/lib/quality/review";
import type { WorkingCalendar } from "@/lib/sprints/calendar";
import type { CodeReviewLog } from "@/lib/stores/workspace-types";
import { bandChartText, hoursText, stateText } from "./view";

/** A table cell: one line, pipes escaped. */
function md(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

const table = (columns: readonly string[], rows: readonly (readonly (string | number)[])[]) => [
  `| ${columns.join(" | ")} |`,
  `| ${columns.map(() => "---").join(" | ")} |`,
  ...rows.map((r) => `| ${r.map(md).join(" | ")} |`),
];

/**
 * The review log as Markdown: the verdict, the headline medians with the
 * working-hours basis, the team view by PR size, and every pull request.
 * No per-author figures.
 */
export function reviewMarkdown(log: CodeReviewLog | null, calendar: WorkingCalendar): string {
  const samples = log?.samples ?? [];
  const window = windowMinutes(log?.workingWindow);
  const summary = reviewSummary(samples, calendar, window);
  const h = summary.headline;
  const lines = ["# Code review metrics", "", `> ${reviewVerdict(summary)}`, ""];
  if (samples.length === 0) return `${lines.join("\n").trimEnd()}\n`;
  lines.push(
    `Working hours: ${workingBasisLabel(calendar, log?.workingWindow)}`,
    "",
    `- Median time to first review: ${hoursText(h.medianFirstReviewWorkingH)} working (${hoursText(h.medianFirstReviewH)} elapsed)`,
    `- Median cycle time: ${hoursText(h.medianCycleWorkingH)} working (${hoursText(h.medianCycleH)} elapsed)`,
    `- P85 cycle time: ${hoursText(h.p85CycleWorkingH)} working`,
    `- Pull requests: ${summary.total} (${summary.merged} merged, ${summary.open} open${summary.invalid > 0 ? `, ${summary.invalid} with dates out of order` : ""})`,
    `- Large PRs merged with no review comment: ${summary.largeNoComments}`,
    "",
    "## By PR size",
    ""
  );
  const bands = bandChartText(summary.bySize).table;
  lines.push(...table(bands.columns, bands.rows), "", "## Pull requests", "");
  lines.push(
    ...table(
      [
        "PR",
        "Author",
        "Opened",
        "First review",
        "Merged",
        "State",
        "Lines",
        "Comments",
        "Reviewers",
      ],
      samples.map((s) => [
        s.prNumber ?? NO_VALUE,
        s.author,
        s.openedAt,
        s.firstReviewAt ?? NO_VALUE,
        s.mergedAt ?? NO_VALUE,
        stateText(reviewTimes(s, calendar, window)),
        s.linesChanged,
        s.commentCount,
        s.reviewerCount,
      ])
    )
  );
  return `${lines.join("\n")}\n`;
}
