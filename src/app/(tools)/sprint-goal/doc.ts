import type { Sprint, SprintGoal } from "@/lib/stores/workspace-types";
import { hasExampleItems, isExampleId } from "@/components/tool-frame/example-data";

/**
 * Where a sprint goal lives. Each sprint has its own document, under
 * `sprint-goal:sprint:<sprintId>` with `sprintId` set, and its goal
 * statement is mirrored to `Sprint.goal`, which Sprint Planning, the
 * cockpit and the charts show.
 *
 * `sprint-goal:current` keeps its old meaning: the one goal, now the draft
 * for when no sprint is chosen. Goals saved before goals were per sprint
 * live there, and agents still write there (MUST match SG_ID in
 * src/lib/actions/tools/sprint-goal.ts), so the tool offers to move the
 * draft onto a sprint instead of hiding it.
 */

export const DRAFT_GOAL_ID = "sprint-goal:current";
const SPRINT_GOAL_PREFIX = "sprint-goal:sprint:";

/** The document id for `sprintId`'s goal, or the draft's. */
export function goalDocId(sprintId?: string): string {
  return sprintId ? `${SPRINT_GOAL_PREFIX}${sprintId}` : DRAFT_GOAL_ID;
}

/** A goal with nothing in it yet. */
export function emptyGoal(sprintId?: string): SprintGoal {
  return {
    id: goalDocId(sprintId),
    businessObjective: "",
    goal: "",
    criteria: [],
    keyResults: [],
    ...(sprintId ? { sprintId } : {}),
  };
}

const text = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * A stored goal with every field in shape, whatever wrote it: older
 * clients (no `okrIds`), agents (empty arrays), imports (missing fields).
 */
export function normalizeGoal(doc: SprintGoal): SprintGoal {
  const { okrIds, ...rest } = doc;
  const criteria = Array.isArray(doc.criteria) ? doc.criteria : [];
  return {
    ...rest,
    businessObjective: text(doc.businessObjective),
    goal: text(doc.goal),
    criteria: criteria
      .filter((c) => c && typeof c.id === "string")
      .map((c) => ({ ...c, text: text(c.text), relevantChecked: Boolean(c.relevantChecked) })),
    keyResults: Array.isArray(doc.keyResults) ? doc.keyResults.map(text) : [],
    ...(Array.isArray(okrIds)
      ? { okrIds: okrIds.filter((id): id is string => typeof id === "string") }
      : {}),
  };
}

export interface GoalView {
  /** The goal to show and edit. */
  doc: SprintGoal;
  /** False while the sprint has no document: nothing is written until an edit. */
  stored: boolean;
}

/**
 * The goal for `sprint`, or the draft without one. A sprint with no goal
 * document starts from `Sprint.goal` (Sprint Planning may have written
 * it), so the tool never shows an empty goal next to a sprint that has one.
 */
export function viewGoal(docs: readonly SprintGoal[], sprint: Sprint | undefined): GoalView {
  const id = goalDocId(sprint?.id);
  const found = docs.find((d) => d.id === id);
  if (found) {
    const doc = normalizeGoal(found);
    return { doc: sprint ? { ...doc, sprintId: sprint.id } : doc, stored: true };
  }
  return { doc: { ...emptyGoal(sprint?.id), goal: sprint?.goal ?? "" }, stored: false };
}

/** Whether a goal holds anything the user typed or linked. */
export function hasContent(doc: SprintGoal): boolean {
  return Boolean(
    doc.businessObjective.trim() ||
    doc.goal.trim() ||
    doc.criteria.some((c) => c.text.trim()) ||
    doc.keyResults.some((kr) => kr.trim()) ||
    (doc.okrIds?.length ?? 0) > 0
  );
}

/** Whether the example is loaded into this goal (its criteria or its OKR link). */
export function isExampleGoal(doc: SprintGoal): boolean {
  return hasExampleItems(doc.criteria) || (doc.okrIds ?? []).some(isExampleId);
}

/** One line, single spaces: how two goal statements are compared. */
export function cleanGoal(goal: string | undefined): string {
  return (goal ?? "").replace(/\s+/g, " ").trim();
}

export interface GoalConflict {
  /** `Sprint.goal`, as Sprint Planning and the cockpit show it. */
  onSprint: string;
  /** The goal statement in this tool. */
  here: string;
}

/**
 * The two goals when `Sprint.goal` and the sprint's goal document disagree
 * (one was changed in Sprint Planning or by an agent), so the user can pick
 * one; null when they agree, for the draft, and while the example shows
 * (it is never written onto a sprint).
 */
export function goalConflict(view: GoalView, sprint: Sprint | undefined): GoalConflict | null {
  if (!sprint || !view.stored || isExampleGoal(view.doc)) return null;
  const onSprint = cleanGoal(sprint.goal);
  const here = cleanGoal(view.doc.goal);
  return onSprint === here ? null : { onSprint, here };
}

/** The patch that mirrors `goal` onto the sprint, or null when it already says that. */
export function sprintGoalPatch(
  sprint: Pick<Sprint, "goal">,
  goal: string
): Pick<Sprint, "goal"> | null {
  const next = goal.trim();
  if (cleanGoal(sprint.goal) === cleanGoal(next)) return null;
  return { goal: next || undefined };
}

/** The draft, when it holds a goal of the user's own (not the example). */
export function usableDraft(docs: readonly SprintGoal[]): SprintGoal | null {
  const found = docs.find((d) => d.id === DRAFT_GOAL_ID);
  if (!found) return null;
  const draft = normalizeGoal(found);
  return hasContent(draft) && !isExampleGoal(draft) ? draft : null;
}

/** The draft as `sprintId`'s goal document. */
export function draftForSprint(draft: SprintGoal, sprintId: string): SprintGoal {
  return { ...draft, id: goalDocId(sprintId), sprintId };
}

/** What a goal says in a few words: its statement, else its objective. */
export function goalGist(doc: SprintGoal, max = 80): string {
  const t = cleanGoal(doc.goal) || cleanGoal(doc.businessObjective) || "An unfinished goal";
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}
