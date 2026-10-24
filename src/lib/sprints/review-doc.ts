/**
 * Where a sprint review lives, and what it can say without anyone typing
 * it. Shared by the Sprint Review page, the cockpit and the
 * tool.sprint_review.* agent actions.
 *
 * Each sprint has its own document under `sprint-review:sprint:<sprintId>`
 * (with `sprintId` set). `sprint-review:current` keeps its old meaning: the
 * one review from before reviews were per sprint, now the draft for when no
 * sprint is chosen.
 */

import type {
  ChecklistItem,
  DemoFeature,
  Sprint,
  SprintGoal,
  SprintGoalOutcome,
  SprintReview,
  Story,
} from "@/lib/stores/workspace-types";
import { goalDocId } from "./goal-doc";
import { sayDoRatio, type SayDo } from "./metrics";
import { totalStoryPoints } from "./plan";
import { storyProgress } from "./progress";

export const DRAFT_REVIEW_ID = "sprint-review:current";
export const SPRINT_REVIEW_PREFIX = "sprint-review:sprint:";

/** The document id for `sprintId`'s review, or the draft's. */
export function reviewDocId(sprintId?: string | null): string {
  return sprintId ? `${SPRINT_REVIEW_PREFIX}${sprintId}` : DRAFT_REVIEW_ID;
}

/** A review with nothing in it yet; a sprint's takes its name. */
export function blankReview(sprint?: Pick<Sprint, "id" | "name"> | null): SprintReview {
  return {
    id: reviewDocId(sprint?.id),
    ...(sprint ? { sprintId: sprint.id } : {}),
    sprintName: sprint?.name ?? "",
    sprintNumber: "",
    features: [],
    meetingDate: "",
    feedbackItems: [],
    checklistItems: [],
    committed: 0,
    completed: 0,
    totalBacklog: 0,
    backlogDone: 0,
  };
}

/** What a team usually checks before it shows the increment. */
export const STANDARD_CHECKLIST: readonly string[] = [
  "Environment is working",
  "Demo data prepared",
  "Acceptance criteria reviewed",
  "Stakeholders invited",
  "Meeting link shared",
  "Screen sharing tested",
  "Backup plan ready",
  "Release notes prepared",
];

/**
 * What the review held before reviews were per sprint and nothing was
 * typed: a made-up "Sprint Alpha" with one demo item, the checklist and
 * velocity numbers (40 committed, 36 done). The old page stored it on the
 * first visit (stamping the meeting date), so most drafts are exactly this.
 * It is example content, not the user's, and is read as an empty draft
 * (doc.ts, `isStarterDraft`).
 */
export const LEGACY_STARTER: Omit<SprintReview, "id" | "meetingDate"> = {
  sprintName: "Sprint Alpha",
  sprintNumber: "1",
  features: [
    {
      id: "f1",
      name: "User Login Flow",
      description: "Enhanced authentication with SSO support",
      acceptanceCriteria: "User can log in via email/password and Google SSO",
      timeMinutes: 5,
    },
  ],
  feedbackItems: [],
  checklistItems: STANDARD_CHECKLIST.map((label, i) => ({
    id: `c${i + 1}`,
    label,
    checked: false,
  })),
  committed: 40,
  completed: 36,
  totalBacklog: 200,
  backlogDone: 36,
};

const featureKey = (f: DemoFeature) =>
  [f.id, f.name, f.description, f.acceptanceCriteria, f.timeMinutes].join("\u0000");
const checkKey = (c: ChecklistItem) => [c.id, c.label, c.checked].join("\u0000");

/**
 * Whether the draft is still the old page's starter content, untouched
 * (any meeting date: the old page stamped one on the first visit). Such a
 * draft is shown as empty and never offered for a sprint.
 */
export function isStarterDraft(doc: SprintReview): boolean {
  const s = LEGACY_STARTER;
  return (
    doc.id === DRAFT_REVIEW_ID &&
    !doc.sprintId &&
    doc.sprintName === s.sprintName &&
    doc.sprintNumber === s.sprintNumber &&
    doc.feedbackItems.length === 0 &&
    doc.features.map(featureKey).join("\n") === s.features.map(featureKey).join("\n") &&
    doc.checklistItems.map(checkKey).join("\n") === s.checklistItems.map(checkKey).join("\n") &&
    doc.committed === s.committed &&
    doc.completed === s.completed &&
    doc.totalBacklog === s.totalBacklog &&
    doc.backlogDone === s.backlogDone
  );
}

/**
 * Whether a review has anything of the user's in it beyond its sprint's
 * name. The old page's untouched starter draft has none.
 */
export function reviewHasContent(r: SprintReview | undefined | null): boolean {
  return Boolean(
    r &&
    !isStarterDraft(r) &&
    (r.features.length > 0 || r.feedbackItems.length > 0 || r.checklistItems.length > 0)
  );
}

/* ── Demo items from done stories ────────────────────────────────────── */

/**
 * The demo item made from a story has an id derived from the story's, so
 * the page (and an agent) can tell which done stories are already in the
 * demo without a field the document doesn't have.
 */
export function demoIdFor(storyId: string): string {
  return `story-${storyId}`;
}

/** A demo item for a done story: its title, not timed yet. */
export function featureFromStory(story: Pick<Story, "id" | "title">): DemoFeature {
  return {
    id: demoIdFor(story.id),
    name: story.title.trim(),
    description: "",
    acceptanceCriteria: "",
    timeMinutes: 0,
  };
}

/** The review with demo items for `stories` added (those not in it yet). */
export function withStoriesInDemo(doc: SprintReview, stories: readonly Story[]): SprintReview {
  const ids = new Set(doc.features.map((f) => f.id));
  const added = stories.filter((s) => !ids.has(demoIdFor(s.id))).map(featureFromStory);
  return added.length === 0 ? doc : { ...doc, features: [...doc.features, ...added] };
}

const GOAL_MET = new Set(["met", "partly", "not-met"]);

export interface ReviewFacts {
  /** The sprint goal: its goal document's statement, else `Sprint.goal`. */
  goal: string | null;
  /** The answer to "Did we meet the sprint goal?", from Sprint Goal. */
  goalOutcome: SprintGoalOutcome | null;
  /** Done stories, in stored order: the demo candidates. */
  done: Story[];
  /** Planned stories that aren't done. */
  notDone: Story[];
  /** Points planned into the sprint (its stories', else `Sprint.pointsPlanned`). */
  committed: number;
  /** Points done (its stories', else `Sprint.pointsCompleted`). */
  completed: number;
  /** Whether the numbers come from the sprint's stories (false: recorded on the
   *  sprint — typed, or confirmed when it was closed). */
  fromStories: boolean;
  /** Done stories with no points. */
  unestimatedDone: number;
  sayDo: SayDo | null;
}

/**
 * What the review can show for `sprint` from the shared data: the goal and
 * whether it was met, the done stories and the points. A team without
 * pointed stories falls back to the numbers typed on the sprint.
 */
export function reviewFacts(
  sprint: Sprint,
  stories: readonly Story[],
  goals: readonly SprintGoal[] | undefined
): ReviewFacts {
  const doc = (goals ?? []).find((g) => g.id === goalDocId(sprint.id));
  const goal = (doc?.goal ?? "").trim() || (sprint.goal ?? "").trim() || null;
  const raw = doc?.outcome;
  const goalOutcome = raw && GOAL_MET.has(raw.met) ? raw : null;
  const planned = stories.filter((s) => s.sprintId === sprint.id);
  const done = planned.filter((s) => s.status === "done");
  const notDone = planned.filter((s) => s.status !== "done");
  const progress = storyProgress(stories, sprint.id);
  // Closing a sprint records its points and moves the unfinished stories on
  // (to the next sprint or the backlog), so afterwards its stories are only
  // the done ones and would read as 100%. A closed sprint's numbers are the
  // ones recorded on it: the commitment and the points confirmed at close.
  const closed = sprint.status === "completed" && typeof sprint.pointsCompleted === "number";
  const fromStories = !closed && progress.scope > 0;
  const committed = fromStories ? progress.scope : Math.max(0, sprint.pointsPlanned || 0);
  const completed = fromStories ? progress.done : Math.max(0, sprint.pointsCompleted ?? 0);
  return {
    goal,
    goalOutcome,
    done,
    notDone,
    committed,
    completed,
    fromStories,
    unestimatedDone: done.filter((s) => typeof s.points !== "number" || !Number.isFinite(s.points))
      .length,
    sayDo: sayDoRatio(committed, fromStories || sprint.pointsCompleted != null ? completed : null),
  };
}

/* ── Feedback on the backlog ─────────────────────────────────────────── */

/** The longest backlog story title made from a piece of feedback. */
export const FEEDBACK_TITLE_MAX = 120;

/**
 * A piece of feedback as a backlog story's title: one line, cut at a word
 * with an ellipsis when it is long. The story links back to the feedback
 * (its sourceRef), where the full text stays; the backlog would otherwise
 * cut it mid-word at its own limit and say nothing.
 */
export function feedbackStoryTitle(text: string, max = FEEDBACK_TITLE_MAX): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  // A word longer than half the limit is cut where it stands.
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:]+$/, "")}…`;
}

/* ── The review's numbers ─────────────────────────────────────────────── */

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
