/**
 * Closing a sprint from the cockpit: the sprint becomes "Done" with its
 * completed points, and its unfinished stories go where the close dialog
 * said, as one change with one Undo. Stories move the way Sprint Planning
 * moves them (its writer), so their flow stamps agree.
 */

import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint, Story } from "@/lib/stores/workspace-types";
import { createSprint, updateSprint } from "@/lib/sprints/store";
import type { CarryOverPlan } from "@/components/sprints/close-sprint-dialog";
import { liveWriter, placeStory, restoreStories } from "@/app/(tools)/sprint-planning/writer";

export interface ClosedSprint {
  /** The sprint as saved. */
  sprint: Sprint;
  /** The sprint the unfinished stories moved into, if they did. */
  movedTo?: Sprint;
  /** The next sprint, when closing created it. */
  created?: Sprint;
  /** Stories that left the sprint (0 when they wait in Sprint Planning). */
  moved: number;
  /** Put the sprint, its stories and any created sprint back as they were. */
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
        placeStory(liveWriter, s.id, movedTo.id, s.status === "backlog" ? "todo" : s.status);
      }
    }
  } else if (plan?.target === "backlog") {
    for (const s of stories) placeStory(liveWriter, s.id, undefined, "backlog");
  }
  const moved = movedTo || plan?.target === "backlog" ? stories.length : 0;

  return {
    sprint,
    ...(movedTo ? { movedTo } : {}),
    ...(created ? { created } : {}),
    moved,
    revert: () => {
      if (moved > 0) restoreStories(liveWriter, stories);
      const now = useWorkspaceStore.getState();
      if (created) now.removeSprint(created.id);
      now.upsertSprint(before);
    },
  };
}
