import type { Sprint, SprintGoal } from "@/lib/stores/workspace-types";
import { hasExampleItems, isExampleId } from "@/components/tool-frame/example-data";
import { buildExample, withoutExample } from "./example";
import { DRAFT_GOAL_ID, goalDocId } from "@/lib/sprints/goal-doc";

/**
 * Where a sprint goal lives. Each sprint has its own document, under
 * `sprint-goal:sprint:<sprintId>` with `sprintId` set, and its goal
 * statement is mirrored to `Sprint.goal`, which Sprint Planning, the
 * cockpit and the charts show.
 *
 * `sprint-goal:current` keeps its old meaning: the one goal, now the draft
 * for when no sprint is chosen. Goals saved before goals were per sprint
 * live there, and agents write there when they name no sprint (the
 * tool.sprint_goal.* actions share these ids through lib/sprints/goal-doc),
 * so the tool offers to move the draft onto a sprint instead of hiding it.
 */

// The ids live in lib so the tool.sprint_goal.* agent actions use the same ones.
export { DRAFT_GOAL_ID, goalDocId };

/** The longest goal statement the tool keeps (the old tool's limit). */
export const GOAL_MAX_CHARS = 300;

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
 * document, or one whose goal statement is still blank (the objective was
 * written first, or "Clear example" emptied it), starts from `Sprint.goal`:
 * Sprint Planning, the cockpit or an agent may have written it, and the
 * tool never shows an empty goal next to a sprint that has one. Nothing is
 * lost by that, so it isn't a conflict; the next edit stores it.
 */
export function viewGoal(docs: readonly SprintGoal[], sprint: Sprint | undefined): GoalView {
  const id = goalDocId(sprint?.id);
  const found = docs.find((d) => d.id === id);
  const onSprint = sprint?.goal ?? "";
  if (found) {
    const doc = normalizeGoal(found);
    if (!sprint) return { doc, stored: true };
    const goal = cleanGoal(doc.goal) ? doc.goal : onSprint;
    return { doc: { ...doc, goal, sprintId: sprint.id }, stored: true };
  }
  return { doc: { ...emptyGoal(sprint?.id), goal: onSprint }, stored: false };
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

/**
 * Whether the example is loaded into this goal: its criteria, its OKR
 * link, or its objective or goal text, so the notice (and "Clear example")
 * stays until every part of it is gone, and none of it reaches the sprint.
 */
export function isExampleGoal(doc: SprintGoal): boolean {
  const ex = buildExample();
  return (
    hasExampleItems(doc.criteria) ||
    (doc.okrIds ?? []).some(isExampleId) ||
    doc.businessObjective === ex.businessObjective ||
    doc.goal === ex.goal
  );
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

/**
 * The draft, when it holds anything of the user's own. A draft that still
 * has some of the example in it (loaded before goals were per sprint) is
 * offered too, example and all: it is the only place that goal lives.
 */
export function usableDraft(docs: readonly SprintGoal[]): SprintGoal | null {
  const found = docs.find((d) => d.id === DRAFT_GOAL_ID);
  if (!found) return null;
  const draft = normalizeGoal(found);
  return hasContent(withoutExample(draft)) ? draft : null;
}

/** The draft as `sprintId`'s goal document. */
export function draftForSprint(draft: SprintGoal, sprintId: string): SprintGoal {
  return { ...draft, id: goalDocId(sprintId), sprintId };
}

/**
 * The sprint the draft already belongs to. Before goals were per sprint,
 * "Use as the goal of" copied the one goal onto a sprint's `Sprint.goal`,
 * so the sprint whose goal says the draft's is where its objective and
 * criteria go, not whichever sprint is chosen now.
 */
export function draftHome(
  draft: SprintGoal | null,
  sprints: readonly Sprint[]
): Sprint | undefined {
  const goal = cleanGoal(draft?.goal);
  return goal ? sprints.find((s) => cleanGoal(s.goal) === goal) : undefined;
}

/**
 * Whether `sprint` has a goal of its own that moving `draft` onto it would
 * replace, so the move asks first: a goal document with something in it
 * (an empty one left by "Clear example" doesn't count), or a `Sprint.goal`
 * that says something other than the draft.
 */
export function sprintHasOwnGoal(
  docs: readonly SprintGoal[],
  sprint: Sprint,
  draft: SprintGoal | null
): boolean {
  const doc = docs.find((d) => d.id === goalDocId(sprint.id));
  if (doc && hasContent(normalizeGoal(doc))) return true;
  const onSprint = cleanGoal(sprint.goal);
  return Boolean(onSprint) && onSprint !== cleanGoal(draft?.goal);
}

/** What a goal says in a few words: its statement, else its objective. */
export function goalGist(doc: SprintGoal, max = 80): string {
  const t = cleanGoal(doc.goal) || cleanGoal(doc.businessObjective) || "An unfinished goal";
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}
