/**
 * The kinds of work a story or a Kanban card can be, and the team's target
 * mix of them. Kanban's Definition of Workflow and Flow Insights both edit
 * the target mix, and agents set it, so one module holds the names, what
 * they mean, how a typed split is checked and how it is read and written on
 * the workflow definition. Pure (no store, no React), so a page and its
 * agent actions agree.
 */

import { WORK_TYPES, WORKFLOW_DEFINITION_ID } from "@/lib/stores/workspace-types";
import type { WorkType, WorkflowDefinition, WorkflowWorkType } from "@/lib/stores/workspace-types";
import { isBlank, parseNumber, type FormErrors, type Validation } from "@/lib/utils/form";

export const WORK_TYPE_LABEL: Record<WorkType, string> = {
  feature: "Feature",
  defect: "Defect",
  debt: "Debt",
  risk: "Risk",
};

/** What each kind of work means, in a line. */
export const WORK_TYPE_MEANING: Record<WorkType, string> = {
  feature: "New value for the people who use it.",
  defect: "Fixing something that doesn't work as it should.",
  debt: "Work that makes future work easier.",
  risk: "Security, compliance, or reducing an unknown.",
};

/** A target mix: a whole-number share for each kind of work, adding up to 100. */
export type TargetSplit = Record<WorkType, number>;

/** A split as typed into a form: one value per kind of work, blank or a number. */
export type TargetSplitDraft = Partial<Record<WorkType, string | number | null | undefined>>;

/** The fields a split's errors name: each kind of work, and `total` for the sum. */
export type TargetSplitField = WorkType | "total";

/** A whole-number share from 0 to 100. */
function isShare(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100;
}

/** Whether `split` is a target mix: four whole numbers from 0 to 100 that add up to 100. */
export function isTargetSplit(split: unknown): split is TargetSplit {
  if (!split || typeof split !== "object") return false;
  const shares = WORK_TYPES.map((t) => (split as Record<string, unknown>)[t]);
  return shares.every(isShare) && (shares as number[]).reduce((a, b) => a + b, 0) === 100;
}

/**
 * Check a typed split: four whole numbers from 0 to 100 that add up to 100,
 * or all four blank for no target (`values: null`).
 */
export function validateTargetSplit(
  values: TargetSplitDraft
): Validation<TargetSplit | null, TargetSplitField> {
  if (WORK_TYPES.every((t) => isBlank(values[t]))) return { ok: true, values: null };
  const errors: FormErrors<TargetSplitField> = {};
  const split: Partial<TargetSplit> = {};
  for (const type of WORK_TYPES) {
    const raw = values[type];
    if (isBlank(raw)) {
      errors[type] = `Enter a share for ${WORK_TYPE_LABEL[type]}, or clear all four.`;
      continue;
    }
    const n = parseNumber(raw);
    if (!isShare(n)) errors[type] = "Enter a whole number from 0 to 100.";
    else split[type] = n;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const sum = WORK_TYPES.reduce((total, t) => total + (split[t] ?? 0), 0);
  if (sum !== 100) {
    return { ok: false, errors: { total: `The four add up to ${sum}. Make them add up to 100.` } };
  }
  return { ok: true, values: split as TargetSplit };
}

/** The entry for `type` on the definition (the first, when a hand edit repeats one). */
function entryFor(def: WorkflowDefinition | null | undefined, type: WorkType) {
  const list: unknown = def?.workTypes;
  if (!Array.isArray(list)) return undefined;
  return list.find(
    (w): w is WorkflowWorkType => Boolean(w) && typeof w === "object" && w.type === type
  );
}

/**
 * The team's target mix, read from the workflow definition. It counts only
 * when all four kinds of work have a target and they add up to 100;
 * anything else reads as no target (null).
 */
export function targetSplitOf(def: WorkflowDefinition | null | undefined): TargetSplit | null {
  const split = Object.fromEntries(WORK_TYPES.map((t) => [t, entryFor(def, t)?.targetPct]));
  return isTargetSplit(split) ? split : null;
}

/**
 * The workflow definition with `split` as its target mix: each kind of
 * work's `targetPct` set, its meaning kept, in `WORK_TYPES` order. `null`
 * clears every target (a kind left with nothing else is dropped). With no
 * definition yet it creates one, `{id: WORKFLOW_DEFINITION_ID}`, stamped
 * `createdAt`; a change stamps `updatedAt`. The same definition (by
 * reference) when its targets are already `split`. `split` is a checked one
 * (`validateTargetSplit`).
 */
export function withTargetSplit(
  def: WorkflowDefinition | undefined,
  split: TargetSplit | null,
  at: string = new Date().toISOString()
): WorkflowDefinition {
  if (def && sameSplit(targetSplitOf(def), split) && (split || !hasTargets(def))) return def;
  const workTypes: WorkflowWorkType[] = [];
  for (const type of WORK_TYPES) {
    const entry = entryFor(def, type);
    const meaning = typeof entry?.meaning === "string" ? entry.meaning : undefined;
    const next: WorkflowWorkType = { type, ...(meaning !== undefined ? { meaning } : {}) };
    if (split) next.targetPct = split[type];
    if (split || meaning !== undefined) workTypes.push(next);
  }
  const out: WorkflowDefinition = def
    ? { ...def, updatedAt: at }
    : { id: WORKFLOW_DEFINITION_ID, createdAt: at, updatedAt: at };
  if (workTypes.length) out.workTypes = workTypes;
  else delete out.workTypes;
  return out;
}

function sameSplit(a: TargetSplit | null, b: TargetSplit | null): boolean {
  if (a === null || b === null) return a === b;
  return WORK_TYPES.every((t) => a[t] === b[t]);
}

/** Whether any kind of work on the definition carries a target, valid or not. */
function hasTargets(def: WorkflowDefinition): boolean {
  return WORK_TYPES.some((t) => entryFor(def, t)?.targetPct !== undefined);
}
