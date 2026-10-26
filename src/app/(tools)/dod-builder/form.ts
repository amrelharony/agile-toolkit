import type { DodCategory, DodCriterion } from "@/lib/stores/workspace-types";
import { CRITERION_DESCRIPTION_MAX, CRITERION_LABEL_MAX } from "@/lib/dod/model";
import type { Validation } from "@/lib/utils/form";

export interface CriterionDraft {
  label: string;
  category: DodCategory;
  /** New criteria start Required: most of a DoD is what every story must meet. */
  required: boolean;
  description: string;
}

export type CriterionField = keyof CriterionDraft;

export interface CriterionValues {
  label: string;
  category: DodCategory;
  required: boolean;
  description?: string;
}

export const EMPTY_CRITERION: CriterionDraft = {
  label: "",
  category: "code",
  required: true,
  description: "",
};

/** A label as a dedupe key: case, spacing and a closing full stop don't make a new criterion. */
export const labelKey = (label: string): string =>
  label.trim().replace(/\s+/g, " ").replace(/\.$/, "").toLowerCase();

/**
 * Check a new criterion: it needs words, and the DoD can't hold the same
 * criterion twice. The category and Required are visible choices.
 */
export function validateCriterion(
  d: CriterionDraft,
  existing: readonly Pick<DodCriterion, "label">[]
): Validation<CriterionValues, CriterionField> {
  const errors: Partial<Record<CriterionField, string>> = {};
  const label = d.label.replace(/\s*[\r\n]+\s*/g, " ").trim();
  const description = d.description.trim();
  if (!label) errors.label = "Say what a done story must have.";
  else if (label.length > CRITERION_LABEL_MAX) {
    errors.label = `Keep it to ${CRITERION_LABEL_MAX} characters.`;
  } else if (existing.some((c) => labelKey(c.label) === labelKey(label))) {
    errors.label = "That criterion is already in the Definition of Done.";
  }
  if (description.length > CRITERION_DESCRIPTION_MAX) {
    errors.description = `Keep it to ${CRITERION_DESCRIPTION_MAX} characters.`;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: {
      label,
      category: d.category,
      required: d.required,
      ...(description ? { description } : {}),
    },
  };
}
