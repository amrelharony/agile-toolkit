/**
 * The add-stage form's draft and its checks, and the same checks for a
 * number edited in place on a stage card. Nothing has a default: a stage
 * that got 1 / 2 / 90 on "Add" read as 50% flow efficiency from nothing.
 */

import { parseNumber, requiredErrors, type Validation } from "@/lib/utils/form";
import type { ValueStreamStage } from "@/lib/stores/workspace-types";

/** Longest stage name the form accepts. */
export const STAGE_NAME_MAX = 80;
export const STAGE_DESCRIPTION_MAX = 500;

export interface StageDraft {
  name: string;
  description: string;
  processTime: string;
  leadTime: string;
  completeAccurate: string;
}

export const EMPTY_STAGE: StageDraft = {
  name: "",
  description: "",
  processTime: "",
  leadTime: "",
  completeAccurate: "",
};

export type StageValues = Pick<
  ValueStreamStage,
  "name" | "processTime" | "leadTime" | "completeAccurate"
> & { description?: string };

type Field = "name" | "processTime" | "leadTime" | "completeAccurate";

/** Why a typed time isn't one, or null when it is. */
export function timeError(raw: string, what: string): string | null {
  const n = parseNumber(raw);
  if (n === undefined) return `Enter the ${what}, in days.`;
  if (!Number.isFinite(n)) return `The ${what} must be a number of days.`;
  if (n < 0) return `The ${what} can't be negative.`;
  return null;
}

/** Why a typed %C/A isn't one, or null when it is. */
export function accuracyError(raw: string): string | null {
  const n = parseNumber(raw);
  if (n === undefined) return "Enter the %C/A: how much work leaves complete and accurate.";
  if (!Number.isFinite(n) || n < 0 || n > 100) return "The %C/A is a percentage from 0 to 100.";
  return null;
}

/** Process time is part of the lead time, so it can't be longer. */
export function processOverLead(process: number, lead: number): string | null {
  return process > lead
    ? `Process time can't be longer than the lead time (${lead} d): the lead time includes it.`
    : null;
}

export function validateStage(draft: StageDraft): Validation<StageValues, Field> {
  const errors = requiredErrors<Field>(
    { name: draft.name },
    { name: "Name the stage, e.g. Code review." }
  );
  const process = timeError(draft.processTime, "process time");
  const lead = timeError(draft.leadTime, "lead time");
  const accuracy = accuracyError(draft.completeAccurate);
  if (process) errors.processTime = process;
  if (lead) {
    errors.leadTime = lead;
  } else if (Number(draft.leadTime) === 0) {
    errors.leadTime = "A stage takes some time: enter more than 0.";
  }
  if (accuracy) errors.completeAccurate = accuracy;
  if (!errors.processTime && !errors.leadTime) {
    const over = processOverLead(Number(draft.processTime), Number(draft.leadTime));
    if (over) errors.processTime = over;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const description = draft.description.trim().slice(0, STAGE_DESCRIPTION_MAX);
  return {
    ok: true,
    values: {
      name: draft.name.trim().slice(0, STAGE_NAME_MAX),
      processTime: Number(draft.processTime),
      leadTime: Number(draft.leadTime),
      completeAccurate: Number(draft.completeAccurate),
      ...(description ? { description } : {}),
    },
  };
}

/**
 * Why a number edited on a stage card can't be saved, or null. The other
 * time on the card is the stored one: raising both means raising the lead
 * time first.
 */
export function editError(
  stage: Pick<ValueStreamStage, "processTime" | "leadTime">,
  field: "processTime" | "leadTime" | "completeAccurate",
  raw: string
): string | null {
  if (field === "completeAccurate") return accuracyError(raw);
  const err = timeError(raw, field === "processTime" ? "process time" : "lead time");
  if (err) return err;
  const n = Number(raw);
  if (field === "leadTime" && n === 0) return "A stage takes some time: enter more than 0.";
  return field === "processTime"
    ? processOverLead(n, stage.leadTime)
    : n < stage.processTime
      ? `The lead time can't be shorter than the process time (${stage.processTime} d).`
      : null;
}
