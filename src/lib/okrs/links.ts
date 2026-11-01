/**
 * The link between sprint goals and OKRs, read from both ends. A sprint
 * goal links the OKRs it moves (`SprintGoal.okrIds`) instead of copying
 * their key results: the numbers stay in the OKR Tracker, and the goal
 * shows them as they are today. Sprint Goal is the only writer of the
 * link; the OKR Tracker and tool.okrs.list_state read it back per
 * objective (sprintGoalsFor).
 *
 * Pure; server-safe (the agent actions call it on the server).
 */

import type { Okr, Sprint, SprintGoal, SprintGoalOutcome } from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";

export interface LinkedOkrs {
  /** Linked OKRs that exist, in link order. */
  linked: Okr[];
  /** Linked ids whose OKR was deleted. */
  missing: string[];
}

/** A goal's linked OKR ids resolved against the OKRs that exist; each id once. */
export function resolveLinkedOkrs(
  okrIds: readonly string[] | undefined,
  okrs: readonly Okr[]
): LinkedOkrs {
  const byId = new Map(okrs.map((o) => [o.id, o]));
  const linked: Okr[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const id of okrIds ?? []) {
    if (seen.has(id)) continue;
    seen.add(id);
    const okr = byId.get(id);
    if (okr) linked.push(okr);
    else missing.push(id);
  }
  return { linked, missing };
}

/** One sprint goal that links an objective, as the OKR Tracker lists it. */
export interface SprintGoalLink {
  /** The goal document's id (lib/sprints/goal-doc goalDocId). */
  goalId: string;
  /** The goal's sprint, or null for the draft goal (sprint-goal:current), which has none. */
  sprintId: string | null;
  /** The sprint's name, or "Draft goal". */
  sprintName: string;
  /** The goal statement, as written ("" while only the link is set). */
  goal: string;
  /** Whether the sprint met its goal, once the team has said. */
  met?: SprintGoalOutcome["met"];
}

/**
 * The sprint goals that link objective `okrId`, oldest sprint first (by
 * start day, then name) and the draft goal last. A goal whose sprint was
 * deleted is left out (its link can't be opened), as are example sprints'
 * goals: example rows never count as the team's own.
 */
export function sprintGoalsFor(
  okrId: string,
  goals: readonly SprintGoal[],
  sprints: readonly Sprint[]
): SprintGoalLink[] {
  const sprintById = new Map(sprints.map((s) => [s.id, s]));
  const dated: { link: SprintGoalLink; start: string }[] = [];
  const drafts: SprintGoalLink[] = [];
  for (const g of goals) {
    if (!(g.okrIds ?? []).includes(okrId)) continue;
    const met = g.outcome?.met;
    const base = { goalId: g.id, goal: g.goal ?? "", ...(met ? { met } : {}) };
    if (!g.sprintId) {
      drafts.push({ ...base, sprintId: null, sprintName: "Draft goal" });
      continue;
    }
    const sprint = sprintById.get(g.sprintId);
    if (!sprint || isExampleId(sprint.id)) continue;
    dated.push({
      link: { ...base, sprintId: sprint.id, sprintName: sprint.name },
      start: sprint.startDate ?? "",
    });
  }
  dated.sort(
    (a, b) =>
      (a.start < b.start ? -1 : a.start > b.start ? 1 : 0) ||
      a.link.sprintName.localeCompare(b.link.sprintName)
  );
  return [...dated.map((d) => d.link), ...drafts];
}
