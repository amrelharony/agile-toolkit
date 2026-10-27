import { generateCodeReviewPrompts } from "@/lib/ai-prompts/code-review-metrics";
import type { PromptDefinition } from "@/lib/ai-prompts/types";
import type { ReviewSummary, ReviewTimes } from "@/lib/quality/review";
import type { PrSample } from "@/lib/stores/workspace-types";

const AVG_CYCLE = /Avg cycle: ([\d.]+)h\./;
const AVG_CYCLE_SHORT = /avg cycle ([\d.]+|—)h\./;
const CYCLE_COLUMN = "| Cycle (h) |";
const BY_AUTHOR = "by author, review comments";
const AUTHORS_QUESTION = " or with a few specific authors/reviewers?";

const meanOf = (xs: readonly number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

/**
 * The AI prompts for the logged PRs, from the same summary the page shows.
 *
 * The shared generator still labels its cycle figure an average of plain
 * hours, while the page passes the median working cycle (the headline) and
 * each PR's working hours; and it asks for stuck reviews "by author", which
 * the page leaves out on purpose (review flow by PR size, no ranking of
 * people). Those lines are relabelled here so the prompt says what the
 * numbers are, with the working-hours `basis`. (A median, working-hours
 * input in the generator would be the clean fix; it lives in lib/ai-prompts.)
 */
export function reviewPrompts(
  rows: readonly { sample: PrSample; times: ReviewTimes }[],
  summary: ReviewSummary,
  basis: string
): PromptDefinition[] {
  const samples = rows.map((r) => r.sample);
  const prompts = generateCodeReviewPrompts({
    samples: rows.map(({ sample: s, times }) => ({
      prNumber: s.prNumber,
      author: s.author,
      cycleHours: times.cycleWorkingH,
      reviewerCount: s.reviewerCount,
      commentCount: s.commentCount,
      linesChanged: s.linesChanged,
      description: s.description,
    })),
    avgCycleHours: summary.headline.medianCycleWorkingH,
    avgReviewDepth: meanOf(samples.map((s) => s.commentCount)),
    avgPrSize: meanOf(samples.map((s) => s.linesChanged)),
    unmerged: summary.open,
  });
  return prompts.map((p) => ({
    ...p,
    description: p.description.replace(BY_AUTHOR, "by review comments"),
    prompt: p.prompt
      .replace(AVG_CYCLE, `Median cycle: $1h of working time (${basis}).`)
      .replace(AVG_CYCLE_SHORT, (_, n: string) =>
        n === "—" ? "no merged PRs yet." : `median cycle ${n}h of working time.`
      )
      .replaceAll(CYCLE_COLUMN, "| Cycle (working h) |")
      .replace(AUTHORS_QUESTION, "?"),
  }));
}
