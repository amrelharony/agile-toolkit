import { nanoid } from "nanoid";
import type {
  DesignSprintDayNumber,
  DesignSprintOutput,
  DesignSprintOutputKind,
  DesignSprintPlan,
  DesignSprintTask,
  HandoffLink,
} from "@/lib/stores/workspace-types";
import { getHandoffRoute } from "@/lib/handoffs/registry";
import { removeWithUndo, undoable } from "@/lib/utils/undoable";
import { dayOutputs, dayTasks, planDay, updateDay, withOutputPatch, withTaskPatch } from "./doc";
import {
  sameOutputValues,
  withOutputValues,
  type OutputSlot,
  type OutputValues,
  type QuestionAnswer,
} from "./outputs";
import { readPlan, updatePlan } from "./use-design-sprint";

/**
 * The page's edits to the stored plan, one item at a time. Each reads the
 * plan as it is now (an agent may have changed another day meanwhile) and
 * returns what it did, so the page can log it and announce it.
 */

const short = (text: string, max = 40) => {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

/* ── Tasks ──────────────────────────────────────────────────────────── */

/** Flip a task's done flag against the stored value; the new value, or null when it's gone. */
export function toggleTask(day: DesignSprintDayNumber, id: string): boolean | null {
  let done: boolean | null = null;
  updatePlan((p) =>
    updateDay(p, day, (d) =>
      withTaskPatch(d, id, (t) => {
        done = !t.done;
        return { ...t, done };
      })
    )
  );
  return done;
}

export function addTask(day: DesignSprintDayNumber, text: string): DesignSprintTask | null {
  const task: DesignSprintTask = { id: crypto.randomUUID(), text, done: false };
  const ok = updatePlan((p) => updateDay(p, day, (d) => ({ ...d, tasks: [...dayTasks(d), task] })));
  return ok ? task : null;
}

/** Save an edited task's text and owner; false when nothing changed. */
export function saveTask(
  day: DesignSprintDayNumber,
  task: DesignSprintTask,
  values: { text: string; owner?: string }
): boolean {
  if (task.text === values.text && (task.owner || undefined) === values.owner) return false;
  updatePlan((p) =>
    updateDay(p, day, (d) =>
      withTaskPatch(d, task.id, (t) => {
        const next: DesignSprintTask = { ...t, text: values.text };
        if (values.owner) next.owner = values.owner;
        else delete next.owner;
        return next;
      })
    )
  );
  return true;
}

export function removeTask(day: DesignSprintDayNumber, task: DesignSprintTask): void {
  removeWithUndo<DesignSprintTask>({
    label: `Deleted the task “${short(task.text)}”`,
    update: (fn) => updatePlan((p) => updateDay(p, day, (d) => ({ ...d, tasks: fn(dayTasks(d)) }))),
    match: (t) => t.id === task.id,
  });
}

/* ── Outputs ────────────────────────────────────────────────────────── */

export function addOutput(
  day: DesignSprintDayNumber,
  kind: DesignSprintOutputKind,
  values: OutputValues
): DesignSprintOutput | null {
  const output: DesignSprintOutput = {
    id: nanoid(10),
    kind,
    ...values,
    createdAt: new Date().toISOString(),
  };
  const ok = updatePlan((p) =>
    updateDay(p, day, (d) => ({ ...d, outputs: [...dayOutputs(d), output] }))
  );
  return ok ? output : null;
}

/** Save an edited output; false when nothing the form shows changed. */
export function saveOutput(
  day: DesignSprintDayNumber,
  slot: Pick<OutputSlot, "kind" | "link">,
  output: DesignSprintOutput,
  values: OutputValues
): boolean {
  if (sameOutputValues(slot, output, values)) return false;
  updatePlan((p) =>
    updateDay(p, day, (d) =>
      withOutputPatch(d, output.id, (o) => withOutputValues(slot, o, values))
    )
  );
  return true;
}

export function removeOutput(
  day: DesignSprintDayNumber,
  output: DesignSprintOutput,
  noun: string
): void {
  removeWithUndo<DesignSprintOutput>({
    label: `Deleted the ${noun} “${short(output.text)}”`,
    update: (fn) =>
      updatePlan((p) => updateDay(p, day, (d) => ({ ...d, outputs: fn(dayOutputs(d)) }))),
    match: (o) => o.id === output.id,
  });
}

/** Test day's answer to a Map-day sprint question; null clears it. */
export function setAnswer(questionId: string, answer: QuestionAnswer | null): void {
  updatePlan((p) =>
    updateDay(p, 1, (d) =>
      withOutputPatch(d, questionId, (o) => {
        const next = { ...o };
        if (answer) next.answer = answer;
        else delete next.answer;
        return next;
      })
    )
  );
}

/** Where an output was sent, read from the stored plan. */
export function outputLinks(
  day: DesignSprintDayNumber,
  id: string
): readonly HandoffLink[] | undefined {
  const plan = readPlan();
  return plan ? dayOutputs(planDay(plan, day)).find((o) => o.id === id)?.sentTo : undefined;
}

/**
 * Record a change to an output's links (a send, or its Undo). Returns the
 * links the change added whose target exists, so the page logs real sends
 * only: undoing a send over a dead link puts that link back, and it isn't a
 * new send to a target long deleted.
 */
export function setOutputLinks(
  day: DesignSprintDayNumber,
  id: string,
  update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]
): HandoffLink[] {
  let added: HandoffLink[] = [];
  updatePlan((p) =>
    updateDay(p, day, (d) =>
      withOutputPatch(d, id, (o) => {
        const before = o.sentTo ?? [];
        const after = update(o.sentTo);
        added = after.filter(
          (l) =>
            !before.some((b) => b.route === l.route && b.targetId === l.targetId) &&
            Boolean(getHandoffRoute(l.route)?.exists(l.targetId))
        );
        return { ...o, sentTo: after };
      })
    )
  );
  return added;
}

/* ── The whole sprint ───────────────────────────────────────────────── */

/** Mark the sprint finished, with Undo (which reopens it). */
export function completeSprint(plan: DesignSprintPlan, onDone?: (completedAt: string) => void) {
  const completedAt = new Date().toISOString();
  undoable({
    label: `Completed “${short(plan.name)}”`,
    apply: () => {
      updatePlan((p) => ({ ...p, completedAt }));
      onDone?.(completedAt);
    },
    revert: () => updatePlan(withoutCompletedAt),
  });
}

export function reopenSprint(): void {
  updatePlan(withoutCompletedAt);
}

function withoutCompletedAt(p: DesignSprintPlan): DesignSprintPlan {
  const next = { ...p };
  delete next.completedAt;
  return next;
}
