/**
 * Closing a sprint from the cockpit: the sprint becomes "Done" with its
 * completed points, and its unfinished stories go where the close dialog
 * said, as one change with one Undo. Stories move the way Sprint Planning
 * moves them (its writer), so their flow stamps agree, and each move is
 * recorded as a carry-over in the story's sprint history.
 *
 * The close dialog's finished step can then record the team's answer to
 * "Did we meet the sprint goal?" as part of the same close (`answerGoal`):
 * the one Undo takes the answer back with the sprint and its stories.
 */

import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint, SprintGoalOutcome, Story } from "@/lib/stores/workspace-types";
import { goalDocId } from "@/lib/sprints/goal-doc";
import { createSprint, setStorySprint, updateSprint } from "@/lib/sprints/store";
import type { CarryOverPlan } from "@/components/sprints/close-sprint-dialog";
import { liveWriter, placeStory, restoreStories } from "@/app/(tools)/sprint-planning/writer";
import { viewGoal } from "@/app/(tools)/sprint-goal/doc";
import { withOutcome, withoutOutcome, type OutcomeValues } from "@/app/(tools)/sprint-goal/outcome";

export interface ClosedSprint {
  /** The sprint as saved. */
  sprint: Sprint;
  /** The sprint the unfinished stories moved into, if they did. */
  movedTo?: Sprint;
  /** The next sprint, when closing created it. */
  created?: Sprint;
  /** Stories that left the sprint (0 when they wait in Sprint Planning). */
  moved: number;
  /**
   * Record the team's answer to "Did we meet the sprint goal?" as part of
   * this close, on the sprint's goal document (the field the Sprint Goal
   * page writes). `revert` takes it back with the rest. Nothing happens
   * once the close was undone, or if the sprint is gone.
   */
  answerGoal: (values: OutcomeValues) => void;
  /**
   * Put the sprint, its stories and any created sprint back as they were,
   * and take back a goal answer this close recorded.
   */
  revert: () => void;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What happens to the unfinished stories, in words, for the close toast. */
export function carryOverLine(plan: CarryOverPlan | undefined): string | undefined {
  const n = plan?.stories.length ?? 0;
  if (!plan || n === 0) return undefined;
  const stories = plural(n, "unfinished story", "unfinished stories");
  switch (plan.target) {
    case "next":
      return plan.nextSprint
        ? `${stories} moved to ${plan.nextSprint.name}.`
        : `${stories} moved to a new sprint, ${plan.newSprint?.name ?? "the next one"}.`;
    case "backlog":
      return `${stories} went back to the backlog.`;
    case "later":
      return `${stories} wait in Sprint Planning.`;
  }
}

/**
 * Close sprint `id` with `pointsCompleted` and carry its unfinished stories
 * over as `plan` says. The stories are read from the store as they are now
 * (one done since the dialog opened stays put). "Next sprint" uses the
 * planned sprint if it still exists, else creates the new one. Returns null
 * when the sprint is gone.
 */
export function closeSprint(
  id: string,
  pointsCompleted: number,
  plan?: CarryOverPlan
): ClosedSprint | null {
  const ws = useWorkspaceStore.getState();
  const before = ws.sprints.find((s) => s.id === id);
  if (!before) return null;
  const listed = new Set((plan?.stories ?? []).map((s) => s.id));
  const stories: Story[] = ws.stories.filter(
    (s) => listed.has(s.id) && s.sprintId === id && s.status !== "done"
  );

  const sprint = updateSprint(id, { status: "completed", pointsCompleted }) ?? before;
  let movedTo: Sprint | undefined;
  let created: Sprint | undefined;
  if (plan?.target === "next" && stories.length > 0) {
    const planned = plan.nextSprint;
    movedTo = planned ? ws.sprints.find((s) => s.id === planned.id) : undefined;
    if (!movedTo && plan.newSprint) movedTo = created = createSprint(plan.newSprint);
    if (movedTo) {
      for (const s of stories) {
        // Recorded as a carry-over, so the trends can tell it from a descope.
        setStorySprint(s.id, movedTo.id, { carriedOver: true });
        placeStory(liveWriter, s.id, movedTo.id, s.status === "backlog" ? "todo" : s.status);
      }
    }
  } else if (plan?.target === "backlog") {
    for (const s of stories) {
      setStorySprint(s.id, undefined, { carriedOver: true });
      placeStory(liveWriter, s.id, undefined, "backlog");
    }
  }
  const moved = movedTo || plan?.target === "backlog" ? stories.length : 0;

  let undone = false;
  // The answer the goal held before this close recorded one (usually none).
  let answered: { before: SprintGoalOutcome | undefined } | null = null;

  return {
    sprint,
    ...(movedTo ? { movedTo } : {}),
    ...(created ? { created } : {}),
    moved,
    answerGoal: (values) => {
      if (undone) return;
      const now = useWorkspaceStore.getState();
      const current = now.sprints.find((s) => s.id === id);
      if (!current) return;
      // As the Sprint Goal page writes it: a sprint without a goal document
      // gets one, goal statement included.
      const { doc } = viewGoal(now.sprintGoals ?? [], current);
      if (!answered) answered = { before: doc.outcome };
      now.upsertSprintGoal(withOutcome(doc, values));
    },
    revert: () => {
      undone = true;
      if (moved > 0) restoreStories(liveWriter, stories);
      const now = useWorkspaceStore.getState();
      if (answered) {
        const doc = (now.sprintGoals ?? []).find((d) => d.id === goalDocId(id));
        if (doc) now.upsertSprintGoal(withoutOutcome(doc, answered.before));
      }
      if (created) now.removeSprint(created.id);
      now.upsertSprint(before);
    },
  };
}
