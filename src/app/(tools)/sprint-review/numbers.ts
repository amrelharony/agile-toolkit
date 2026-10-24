/**
 * The review's numbers as the page words them: which source they come
 * from, the unfinished stories, backlog progress and the chart text. The
 * numbers themselves (stories, then the review's typed numbers, then the
 * sprint's own) are worked out in lib/sprints/review-doc, shared with the
 * agent actions; re-exported here for the page.
 */

import type { Story } from "@/lib/stores/workspace-types";
import type { ReviewNumbers } from "@/lib/sprints/review-doc";
import { SAY_DO_GRADE_LABEL } from "@/lib/sprints/metrics";
import { totalStoryPoints } from "@/lib/sprints/plan";
import { fmt, type ChartText } from "@/lib/charts/chart-text";

export { reviewNumbers, sprintOwnNumbers } from "@/lib/sprints/review-doc";
export type { NumbersSource, ReviewNumbers } from "@/lib/sprints/review-doc";

/** "1 pt", "34 pts". */
export const pointsLabel = (n: number) => `${fmt(n)} ${n === 1 ? "pt" : "pts"}`;

/**
 * The unfinished stories in a few words: "2 stories, 5 pts", or "2
 * stories, not estimated" when none of them has points (never "0 points").
 */
export function notDoneSummary(stories: readonly Story[]): string {
  const count = `${stories.length} ${stories.length === 1 ? "story" : "stories"}`;
  const estimated = stories.some((s) => typeof s.points === "number" && Number.isFinite(s.points));
  return `${count}, ${estimated ? pointsLabel(totalStoryPoints(stories)) : "not estimated"}`;
}

/** Where the numbers came from, in a line under them. */
export function sourceNote(n: ReviewNumbers, sprintName: string | undefined): string {
  switch (n.source) {
    case "stories":
      return `From the ${n.storyCount === 1 ? "story" : `${n.storyCount} stories`} planned into ${sprintName}.`;
    case "typed":
      if (!sprintName) return "Typed here.";
      return `Typed here, because ${sprintName} has no pointed stories.${
        n.fromSprint ? ` The ${n.fromSprint} points are ${sprintName}'s own.` : ""
      }`;
    case "sprint":
      return `${sprintName}'s own numbers (typed in Velocity or by an agent), because it has no pointed stories. Type numbers below to use others.`;
    default:
      return sprintName
        ? `No numbers yet. Plan pointed stories into ${sprintName}, or type the points below.`
        : "No numbers yet. Type the points below.";
  }
}

export interface BacklogProgress {
  /** Points of every story. */
  total: number;
  /** Points of the done ones. */
  done: number;
}

/** How far through all its stories the product is, by points. */
export function backlogProgress(stories: readonly Story[]): BacklogProgress {
  return {
    total: totalStoryPoints(stories),
    done: totalStoryPoints(stories.filter((s) => s.status === "done")),
  };
}

/** The bars' sentence and rows: committed against completed points. */
export function numbersChartText(n: ReviewNumbers, sprintName: string | undefined): ChartText {
  const done = n.completed ?? 0;
  const notDone = Math.max(0, Math.round((n.committed - done) * 10) / 10);
  let summary: string;
  if (n.committed <= 0) {
    summary = `${fmt(done)} points done; no commitment was recorded.`;
  } else if (n.completed === null) {
    summary = `${fmt(n.committed)} points committed; how many were done isn't recorded yet.`;
  } else {
    const grade = n.sayDo ? `: ${SAY_DO_GRADE_LABEL[n.sayDo.grade].toLowerCase()}` : "";
    summary = `${fmt(done)} of ${fmt(n.committed)} committed points done (${n.sayDo?.pct ?? 0}%)${grade}.`;
  }
  return {
    summary,
    table: {
      caption: sprintName ? `Points in ${sprintName}` : "Points this sprint",
      columns: ["Measure", "Points"],
      rows:
        n.committed > 0 || done > 0
          ? [
              ["Committed", n.committed > 0 ? n.committed : "—"],
              ["Completed", n.completed === null ? "—" : done],
              ["Not done", n.completed === null || n.committed <= 0 ? "—" : notDone],
            ]
          : [],
    },
  };
}
