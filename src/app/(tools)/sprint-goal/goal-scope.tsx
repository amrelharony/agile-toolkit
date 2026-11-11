"use client";

import Link from "@/components/motion/transition-link";
import { ArrowRight } from "lucide-react";
import { SprintPicker } from "@/components/sprints/sprint-picker";
import { Button } from "@/components/ui/button";
import { sprintHref } from "@/lib/sprints/use-selected-sprint";
import type { Sprint, SprintGoal } from "@/lib/stores/workspace-types";
import { GOAL_MAX_CHARS, goalGist, type GoalConflict } from "./doc";
import { withoutExample } from "./example";

const BANNER = "rounded-lg border p-3 text-sm text-text flex flex-col gap-2";

/**
 * Which goal is on screen: a sprint's (picked with the shared sprint
 * picker) or the draft that isn't tied to one. A draft with content is
 * never hidden: while its sprint has no goal of its own it is offered for
 * that sprint, and otherwise it can be opened.
 */
export function GoalScope({
  sprints,
  selected,
  inDraft,
  draftTarget,
  targetHasGoal,
  draft,
  onSelect,
  onOpenDraft,
  onCloseDraft,
  onUseDraft,
  onDiscardDraft,
}: {
  /** Every sprint, newest first. */
  sprints: Sprint[];
  /** The shared sprint choice. */
  selected: Sprint | undefined;
  /** Showing the draft even though a sprint is chosen. */
  inDraft: boolean;
  /**
   * Where "Use it for" moves the draft: the sprint whose goal already says
   * the draft's, else the chosen one.
   */
  draftTarget: Sprint | undefined;
  /** Whether that sprint has a goal of its own, so the move asks first. */
  targetHasGoal: boolean;
  /** The draft, when it holds the user's own goal. */
  draft: SprintGoal | null;
  onSelect: (sprintId: string) => void;
  onOpenDraft: () => void;
  onCloseDraft: () => void;
  onUseDraft: () => void;
  onDiscardDraft: () => void;
}) {
  const onSprint = Boolean(selected) && !inDraft;
  const target = draftTarget ?? selected;
  // The draft already is another sprint's goal (the old tool copied it).
  const elsewhere = Boolean(target && selected && target.id !== selected.id);
  const caption = !selected
    ? "This goal isn't tied to a sprint yet. Add a sprint to keep one goal per sprint, shown in Sprint Planning and the Sprint Cockpit."
    : inDraft
      ? "Showing the draft that isn't tied to a sprint."
      : `One goal per sprint. The goal statement is also ${selected.name}'s goal in Sprint Planning and the Sprint Cockpit.`;

  return (
    <div className="mb-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <SprintPicker
          sprints={sprints}
          selectedId={onSprint ? selected?.id : undefined}
          onSelect={onSelect}
          label="Goal for"
        />
        <p className="min-w-0 flex-1 basis-64 text-sm text-sub">{caption}</p>
      </div>

      {selected && target && inDraft && (
        <div className={`${BANNER} border-info/30 bg-info/10`} role="status">
          <p>
            {!draft
              ? `The draft is empty. ${selected.name}'s goal is one click away.`
              : elsewhere
                ? `This draft is already ${target.name}'s goal. Move it onto ${target.name} to keep its objective and criteria with it.`
                : `Move this draft onto ${target.name} so Sprint Planning and the cockpit show it.`}
          </p>
          <div className="flex flex-wrap gap-2">
            {draft && (
              <Button type="button" size="sm" onClick={onUseDraft}>
                Use it for {target.name}
              </Button>
            )}
            {draft && (
              <Button type="button" size="sm" variant="ghost" onClick={onDiscardDraft}>
                Discard draft
              </Button>
            )}
            <Button type="button" size="sm" variant="outline" onClick={onCloseDraft}>
              Back to {selected.name}
            </Button>
          </div>
        </div>
      )}

      {selected && target && !inDraft && draft && (
        <div className={`${BANNER} border-info/30 bg-info/10`} role="status">
          <p>
            {elsewhere
              ? `${target.name}'s goal came from a draft that isn't tied to a sprint yet:`
              : `${targetHasGoal ? "There's also a draft" : "You have a goal draft"} that isn't tied to a sprint:`}{" "}
            <q>{goalGist(withoutExample(draft))}</q>
          </p>
          <div className="flex flex-wrap gap-2">
            {!targetHasGoal && (
              <Button type="button" size="sm" onClick={onUseDraft}>
                Use it for {target.name}
              </Button>
            )}
            <Button type="button" size="sm" variant="outline" onClick={onOpenDraft}>
              Open draft
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Shown on every step while `Sprint.goal` and this goal disagree, e.g.
 * after the goal was reworded in Sprint Planning: both, and a choice.
 */
export function GoalConflictBanner({
  sprint,
  conflict,
  onUseSprintGoal,
  onSetOnSprint,
}: {
  sprint: Sprint;
  conflict: GoalConflict;
  onUseSprintGoal: () => void;
  onSetOnSprint: () => void;
}) {
  const { onSprint, here } = conflict;
  const heading = !onSprint
    ? `${sprint.name} has no goal yet, so Sprint Planning and the cockpit don't show this one.`
    : !here
      ? `${sprint.name} already has a goal.`
      : `${sprint.name}'s goal doesn't match this one.`;
  // Agents can write a goal of any length onto the sprint; this tool keeps
  // GOAL_MAX_CHARS, so taking it cuts it on both (with Undo).
  const tooLong = onSprint.length > GOAL_MAX_CHARS;

  return (
    <div className={`${BANNER} mb-4 border-warning/40 bg-warning/5`} role="status">
      <p className="font-medium">{heading}</p>
      <dl className="grid gap-1 sm:grid-cols-[auto_1fr] sm:gap-x-3">
        {onSprint && (
          <>
            <dt className="text-sub">On the sprint</dt>
            <dd>
              <q>{onSprint}</q>
            </dd>
          </>
        )}
        {here && (
          <>
            <dt className="text-sub">Here</dt>
            <dd>
              <q>{here}</q>
            </dd>
          </>
        )}
      </dl>
      {tooLong && (
        <p className="text-xs text-sub">
          The sprint&apos;s goal is over {GOAL_MAX_CHARS} characters. Using it here cuts it to{" "}
          {GOAL_MAX_CHARS}, on the sprint too.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {onSprint && (
          <Button type="button" size="sm" variant="outline" onClick={onUseSprintGoal}>
            Use the sprint&apos;s goal here
          </Button>
        )}
        {here && (
          <Button type="button" size="sm" onClick={onSetOnSprint}>
            Set this goal on {sprint.name}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Where a set goal leads: Sprint Planning to pick the stories that serve
 * it, then the cockpit to follow it through the sprint.
 */
export function GoalNextStep({
  sprint,
  plannedStories,
}: {
  sprint: Sprint;
  plannedStories: number;
}) {
  const detail =
    plannedStories === 0
      ? `No stories are planned into ${sprint.name} yet. Pick the ones that serve the goal.`
      : `${plannedStories} ${plannedStories === 1 ? "story is" : "stories are"} planned into ${sprint.name}. Check each one serves the goal.`;
  const link =
    "inline-flex min-h-9 items-center gap-1.5 rounded-md border border-accent/40 bg-card px-3 text-sm font-medium text-accent transition-colors hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
  return (
    <aside
      aria-labelledby="sprint-goal-next-step"
      className="mt-4 rounded-lg border border-accent/30 bg-accent/5 p-4"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-accent">Next step</p>
      <h2 id="sprint-goal-next-step" className="mt-0.5 text-sm font-semibold text-text">
        Plan {sprint.name} around this goal
      </h2>
      <p className="mt-0.5 text-sm text-sub">{detail}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href={sprintHref("/sprint-planning", sprint.id)} className={link}>
          Sprint Planning
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
        <Link href={sprintHref("/sprint", sprint.id)} className={link}>
          Sprint Cockpit
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </aside>
  );
}
