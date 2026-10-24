import type { Sprint, SprintReview, Story } from "@/lib/stores/workspace-types";
import type { ReviewFacts } from "@/lib/sprints/review-doc";
import { SAY_DO_GRADE_LABEL, sayDoRatio, type SayDo } from "@/lib/sprints/metrics";
import { totalStoryPoints } from "@/lib/sprints/plan";
import { fmt, type ChartText } from "@/lib/charts/chart-text";

/**
 * The review's numbers: committed and completed points, and say/do.
 *
 * The sprint's stories are the source. A team without pointed stories
 * types the numbers into the review (the old velocity fields, now the
 * labelled fallback), and a sprint that only has its own typed points
 * (Velocity, an agent) shows those until the review types others.
 */
export type NumbersSource = "stories" | "typed" | "sprint" | "none";

export interface ReviewNumbers {
  source: NumbersSource;
  committed: number;
  /** Points done; null when the source has a commitment but no result yet. */
  completed: number | null;
  sayDo: SayDo | null;
  /** Stories planned into the sprint (0 for the draft). */
  storyCount: number;
  doneCount: number;
  /** Points of the planned stories that aren't done. */
  notDonePoints: number;
}

export function reviewNumbers(
  doc: Pick<SprintReview, "committed" | "completed">,
  facts: ReviewFacts | null,
  sprint?: Pick<Sprint, "pointsCompleted">
): ReviewNumbers {
  const storyCount = facts ? facts.done.length + facts.notDone.length : 0;
  const doneCount = facts ? facts.done.length : 0;
  const notDonePoints = facts ? totalStoryPoints(facts.notDone) : 0;
  const base = { storyCount, doneCount, notDonePoints };
  if (facts?.fromStories) {
    return {
      ...base,
      source: "stories",
      committed: facts.committed,
      completed: facts.completed,
      sayDo: facts.sayDo,
    };
  }
  if (doc.committed > 0 || doc.completed > 0) {
    return {
      ...base,
      source: "typed",
      committed: doc.committed,
      completed: doc.completed,
      sayDo: sayDoRatio(doc.committed, doc.completed),
    };
  }
  if (facts && facts.committed > 0) {
    const known = sprint?.pointsCompleted != null;
    return {
      ...base,
      source: "sprint",
      committed: facts.committed,
      completed: known ? facts.completed : null,
      sayDo: facts.sayDo,
    };
  }
  return { ...base, source: "none", committed: 0, completed: null, sayDo: null };
}

/** Where the numbers came from, in a line under them. */
export function sourceNote(n: ReviewNumbers, sprintName: string | undefined): string {
  switch (n.source) {
    case "stories":
      return `From the ${n.storyCount === 1 ? "story" : `${n.storyCount} stories`} planned into ${sprintName}.`;
    case "typed":
      return sprintName
        ? `Typed here, because ${sprintName} has no pointed stories.`
        : "Typed here.";
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
              ["Committed", n.committed],
              ["Completed", n.completed === null ? "—" : done],
              ["Not done", n.completed === null ? "—" : notDone],
            ]
          : [],
    },
  };
}
