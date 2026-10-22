/**
 * Sprint Planning's reading of the workspace: which stories are in the
 * sprint, which backlog items could be imported, the priority score used
 * to order the backlog, and the warnings shown before committing. Pure.
 */

import type { BacklogItem, Sprint, Story } from "@/lib/stores/workspace-types";
import { storyPoints, totalStoryPoints } from "@/lib/sprints/plan";

/** Trimmed, case-insensitive, single-spaced: how two names count as the same story. */
export const nameKey = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * One priority number from the shared backlog's inputs: WSJF (business
 * value + time criticality + risk reduction, over job size). It is the
 * Scrum-side ordering of the Prioritizer's backlog; a story keeps the score
 * it was imported with.
 */
export function priorityScore(item: BacklogItem): number {
  const cod = item.businessValue + item.timeCriticality + item.riskReduction;
  const size = item.jobSize > 0 ? item.jobSize : 1;
  return Math.round((cod / size) * 100) / 100;
}

/** Stories planned into `sprintId`, done last so the open work reads first. */
export function sprintStories(stories: readonly Story[], sprintId: string): Story[] {
  const inSprint = stories.filter((s) => s.sprintId === sprintId);
  const rank = (s: Story) => (s.status === "done" ? 1 : 0);
  return inSprint.slice().sort((a, b) => rank(a) - rank(b));
}

/** Stories not in any sprint, highest priority first (unscored last). */
export function backlogStories(stories: readonly Story[]): Story[] {
  return stories
    .filter((s) => !s.sprintId && s.status === "backlog")
    .slice()
    .sort((a, b) => (b.priorityScore ?? -Infinity) - (a.priorityScore ?? -Infinity));
}

/** Backlog items with no story of the same name yet, in Prioritizer order. */
export function importCandidates(
  backlogItems: readonly BacklogItem[],
  stories: readonly Story[]
): BacklogItem[] {
  const taken = new Set(stories.map((s) => nameKey(s.title)));
  return backlogItems.filter((b) => b.name.trim() && !taken.has(nameKey(b.name)));
}

/** A story from a backlog item: its name, with the shared priority score. */
export function storyFromBacklogItem(item: BacklogItem, id: string): Story {
  return {
    id,
    title: item.name.trim().slice(0, 200),
    status: "backlog",
    priorityScore: priorityScore(item),
  };
}

export interface PlanWarning {
  id: "no-goal" | "over-capacity" | "unestimated" | "empty" | "another-active";
  text: string;
}

export interface PlanCheckInput {
  sprint: Sprint;
  stories: readonly Story[];
  /** Points the team means to commit to (typed, or the velocity suggestion). */
  targetPoints: number | null;
  otherActive: readonly Sprint[];
}

/** What to look at before starting the sprint, in the order shown. */
export function planWarnings(input: PlanCheckInput): PlanWarning[] {
  const { sprint, stories, targetPoints, otherActive } = input;
  const out: PlanWarning[] = [];
  const total = totalStoryPoints(stories);
  const unestimated = stories.filter((s) => storyPoints(s) <= 0).length;
  if (stories.length === 0) {
    out.push({ id: "empty", text: "No stories are planned into this sprint yet." });
  }
  if (!sprint.goal?.trim()) {
    out.push({
      id: "no-goal",
      text: "The sprint has no goal yet. Teams commit to a goal, not a list.",
    });
  }
  if (targetPoints !== null && targetPoints > 0 && total > targetPoints * 1.1) {
    out.push({
      id: "over-capacity",
      text: `${total} points planned against a capacity of ${targetPoints}: more than 10% over.`,
    });
  }
  if (unestimated > 0) {
    out.push({
      id: "unestimated",
      text: `${unestimated} ${unestimated === 1 ? "story has" : "stories have"} no points, so the commitment can't be weighed.`,
    });
  }
  if (otherActive.length > 0) {
    out.push({
      id: "another-active",
      text: `${otherActive.map((s) => s.name).join(", ")} ${otherActive.length === 1 ? "is" : "are"} still active; starting this one leaves ${otherActive.length === 1 ? "it" : "them"} open.`,
    });
  }
  return out;
}

/** "9 stories · 34 points" */
export function planLine(stories: readonly Story[]): string {
  const n = stories.length;
  return `${n} ${n === 1 ? "story" : "stories"} · ${totalStoryPoints(stories)} points`;
}
