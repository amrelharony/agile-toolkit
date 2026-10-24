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
 *
 * A typed 0 is a field nobody filled in: the document has no "unset" (the
 * old page's blank fields stored 0), so it never counts as 0 points done.
 * A blank field falls back to the sprint's own number, else it reads as
 * not recorded, and say/do waits for both.
 */
export type NumbersSource = "stories" | "typed" | "sprint" | "none";

export interface ReviewNumbers {
  source: NumbersSource;
  /** Points committed; 0 when none is recorded. */
  committed: number;
  /** Points done; null when the source has a commitment but no result yet. */
  completed: number | null;
  sayDo: SayDo | null;
  /** Stories planned into the sprint (0 for the draft). */
  storyCount: number;
  doneCount: number;
  /** Points of the planned stories that aren't done. */
  notDonePoints: number;
  /** Typed numbers only: the field left blank that shows the sprint's own number. */
  fromSprint?: "committed" | "completed";
}

/**
 * The points typed on the sprint itself (Velocity, an agent), for a sprint
 * whose stories have none; null where it has none either.
 */
export function sprintOwnNumbers(
  facts: ReviewFacts | null,
  sprint?: Pick<Sprint, "pointsCompleted">
): { committed: number | null; completed: number | null } {
  if (!facts || facts.fromStories) return { committed: null, completed: null };
  return {
    committed: facts.committed > 0 ? facts.committed : null,
    completed: sprint?.pointsCompleted != null ? facts.completed : null,
  };
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
  const own = sprintOwnNumbers(facts, sprint);
  const typedCommitted = doc.committed > 0 ? doc.committed : null;
  const typedCompleted = doc.completed > 0 ? doc.completed : null;
  if (typedCommitted !== null || typedCompleted !== null) {
    const committed = typedCommitted ?? own.committed ?? 0;
    const completed = typedCompleted ?? own.completed;
    const fromSprint =
      typedCommitted === null && own.committed !== null
        ? "committed"
        : typedCompleted === null && own.completed !== null
          ? "completed"
          : undefined;
    return {
      ...base,
      source: "typed",
      committed,
      completed,
      sayDo: sayDoRatio(committed, completed),
      ...(fromSprint ? { fromSprint } : {}),
    };
  }
  if (own.committed !== null) {
    return {
      ...base,
      source: "sprint",
      committed: own.committed,
      completed: own.completed,
      sayDo: sayDoRatio(own.committed, own.completed),
    };
  }
  return { ...base, source: "none", committed: 0, completed: null, sayDo: null };
}

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
