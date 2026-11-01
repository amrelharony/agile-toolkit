import { RACI_DESCRIPTION_MAX, RACI_NAME_MAX, nameTaken } from "@/lib/raci/model";
import type { Validation } from "@/lib/utils/form";

export interface NameDraft {
  name: string;
  description: string;
}

export type NameField = keyof NameDraft;

export interface NameValues {
  name: string;
  description?: string;
}

export const EMPTY_NAME: NameDraft = { name: "", description: "" };

/**
 * Check a new column or row: it needs a name, and the matrix can't have
 * two with the same one (case and spacing aside), which would make its
 * cells impossible to tell apart.
 */
export function validateName(
  d: NameDraft,
  existing: readonly { name: string }[],
  what: "role" | "activity"
): Validation<NameValues, NameField> {
  const errors: Partial<Record<NameField, string>> = {};
  const name = d.name.replace(/\s+/g, " ").trim();
  const description = d.description.trim();
  if (!name) {
    errors.name = what === "role" ? "Name the person or role." : "Name the activity.";
  } else if (name.length > RACI_NAME_MAX) {
    errors.name = `Keep it to ${RACI_NAME_MAX} characters.`;
  } else if (nameTaken(existing, name)) {
    errors.name =
      what === "role" ? "That role is already a column." : "That activity is already a row.";
  }
  if (description.length > RACI_DESCRIPTION_MAX) {
    errors.description = `Keep it to ${RACI_DESCRIPTION_MAX} characters.`;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, values: { name, ...(description ? { description } : {}) } };
}
