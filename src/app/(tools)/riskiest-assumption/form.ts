/**
 * The Riskiest Assumption page's form: a statement is needed, the ratings
 * are not. An assumption saved without a rating is "Not rated": it isn't
 * ranked or placed in the matrix until both are given, so nothing lands
 * in "Test first" by a default. The caps are lib/assumptions', which
 * tool.riskiest_assumption uses too.
 */

import type { ScaleStep } from "@/components/shared/scale-picker";
import type { Assumption, AssumptionLevel } from "@/lib/stores/workspace-types";
import { ASSUMPTION_STATEMENT_MAX, ASSUMPTION_TEXT_MAX, ratingOf } from "@/lib/assumptions/model";
import type { FormErrors, Validation } from "@/lib/utils/form";

/** How badly the plan suffers if the assumption is wrong. */
export const RISK_STEPS: readonly ScaleStep[] = [
  { value: 1, meaning: "Little harm if this is wrong" },
  { value: 2, meaning: "A detour: some rework if this is wrong" },
  { value: 3, meaning: "A setback: a feature misses if this is wrong" },
  { value: 4, meaning: "Serious: the bet loses most of its value" },
  { value: 5, meaning: "The plan fails if this is wrong" },
];

/** How much evidence backs it today. */
export const EVIDENCE_STEPS: readonly ScaleStep[] = [
  { value: 1, meaning: "A guess, no data yet" },
  { value: 2, meaning: "Anecdotes: a few conversations" },
  { value: 3, meaning: "Some signal: interviews or a small test" },
  { value: 4, meaning: "Good data from a real test" },
  { value: 5, meaning: "Strong data from real users" },
];

export interface AssumptionDraft {
  statement: string;
  /** Unset until picked (null): never a default 3. */
  riskLevel: number | null;
  evidenceLevel: number | null;
  testIdea: string;
  description: string;
}

export type AssumptionField = keyof AssumptionDraft;

export interface AssumptionValues {
  statement: string;
  riskLevel: AssumptionLevel | undefined;
  evidenceLevel: AssumptionLevel | undefined;
  testIdea: string | undefined;
  description: string | undefined;
}

export const emptyAssumptionDraft = (): AssumptionDraft => ({
  statement: "",
  riskLevel: null,
  evidenceLevel: null,
  testIdea: "",
  description: "",
});

export const assumptionDraftFrom = (a: Assumption): AssumptionDraft => ({
  statement: a.statement ?? "",
  riskLevel: ratingOf(a.riskLevel),
  evidenceLevel: ratingOf(a.evidenceLevel),
  testIdea: a.testIdea ?? "",
  description: a.description ?? "",
});

const level = (v: number | null): AssumptionLevel | undefined =>
  v === null ? undefined : (ratingOf(v) ?? undefined);

/**
 * Check the form. `stored` is the saved assumption when editing: a longer
 * statement or note saved before is kept while it is unchanged.
 */
export function validateAssumption(
  d: AssumptionDraft,
  stored?: Assumption
): Validation<AssumptionValues, AssumptionField> {
  const errors: FormErrors<AssumptionField> = {};
  const statement = d.statement.trim();
  const testIdea = d.testIdea.trim();
  const description = d.description.trim();
  const over = (value: string, max: number, kept: string | undefined) =>
    value.length > max && value !== (kept ?? "").trim();
  if (!statement) {
    errors.statement = "Write the assumption as a statement that could be proven wrong.";
  } else if (over(statement, ASSUMPTION_STATEMENT_MAX, stored?.statement)) {
    errors.statement = `Keep it to ${ASSUMPTION_STATEMENT_MAX} characters or fewer.`;
  }
  if (over(testIdea, ASSUMPTION_TEXT_MAX, stored?.testIdea)) {
    errors.testIdea = `Keep it to ${ASSUMPTION_TEXT_MAX} characters or fewer.`;
  }
  if (over(description, ASSUMPTION_TEXT_MAX, stored?.description)) {
    errors.description = `Keep it to ${ASSUMPTION_TEXT_MAX} characters or fewer.`;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: {
      statement,
      riskLevel: level(d.riskLevel),
      evidenceLevel: level(d.evidenceLevel),
      testIdea: testIdea || undefined,
      description: description || undefined,
    },
  };
}

/** The assumption saved with checked values; a value left blank removes its key (absent = not rated). */
export function applyAssumptionValues(a: Assumption, v: AssumptionValues): Assumption {
  const next: Record<string, unknown> = { ...a, statement: v.statement };
  for (const key of ["riskLevel", "evidenceLevel", "testIdea", "description"] as const) {
    if (v[key] === undefined) delete next[key];
    else next[key] = v[key];
  }
  return next as unknown as Assumption;
}
