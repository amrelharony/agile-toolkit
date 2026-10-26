"use client";

import { Plus } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { Validation } from "@/lib/utils/form";
import type { HealthCheck } from "@/lib/stores/workspace-types";
import {
  DIMENSION_DESCRIPTION_MAX,
  DIMENSION_NAME_MAX,
  dimensionNameProblem,
} from "@/lib/health-check/score";

export interface DimensionDraft {
  name: string;
  description: string;
}

export const EMPTY_DIMENSION: DimensionDraft = { name: "", description: "" };

export interface NewDimension {
  name: string;
  description?: string;
}

/** A new dimension needs a name no other dimension has (built-in, the team's, or archived). */
export function validateDimension(
  doc: HealthCheck,
  d: DimensionDraft
): Validation<NewDimension, keyof DimensionDraft> {
  const problem = dimensionNameProblem(doc, d.name);
  if (problem) return { ok: false, errors: { name: problem } };
  if (d.description.trim().length > DIMENSION_DESCRIPTION_MAX) {
    return {
      ok: false,
      errors: { description: `Keep it to ${DIMENSION_DESCRIPTION_MAX} characters.` },
    };
  }
  const description = d.description.trim();
  return { ok: true, values: { name: d.name.trim(), ...(description ? { description } : {}) } };
}

/** "Add a dimension": the team's own, rated on every new check from now on. */
export function DimensionForm({
  doc,
  onAdd,
}: {
  doc: HealthCheck;
  onAdd: (d: NewDimension) => void;
}) {
  const form = useItemForm<DimensionDraft, NewDimension, keyof DimensionDraft>({
    initial: EMPTY_DIMENSION,
    validate: (d) => validateDimension(doc, d),
    onSave: onAdd,
  });
  return (
    <ItemForm
      form={form}
      submitLabel="Add dimension"
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
      className="grid gap-3 sm:grid-cols-2 sm:items-start"
    >
      <Field label="Dimension" required error={form.errors.name} hint="e.g. On-call load">
        {(props) => (
          <Input
            {...props}
            value={form.draft.name}
            maxLength={DIMENSION_NAME_MAX}
            onChange={(e) => form.update({ name: e.target.value })}
          />
        )}
      </Field>
      <Field
        label="What good looks like"
        error={form.errors.description}
        hint="Shown under the dimension and in a live round."
      >
        {(props) => (
          <Input
            {...props}
            value={form.draft.description}
            maxLength={DIMENSION_DESCRIPTION_MAX}
            onChange={(e) => form.update({ description: e.target.value })}
          />
        )}
      </Field>
    </ItemForm>
  );
}
