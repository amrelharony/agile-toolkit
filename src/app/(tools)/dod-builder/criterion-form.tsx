"use client";

import { Plus } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import type { DodCategory, DodCriterion } from "@/lib/stores/workspace-types";
import {
  CRITERION_DESCRIPTION_MAX,
  CRITERION_LABEL_MAX,
  DOD_CATEGORIES,
  DOD_CATEGORY_LABEL,
} from "@/lib/dod/model";
import {
  EMPTY_CRITERION,
  validateCriterion,
  type CriterionDraft,
  type CriterionField,
  type CriterionValues,
} from "./form";

/**
 * "Add a criterion": one form for every category, so a draft can't land
 * in another tab. New criteria start Required; nothing is saved until the
 * criterion has words and isn't already in the DoD. Enter adds it.
 */
export function AddCriterionForm({
  criteria,
  onAdd,
}: {
  criteria: readonly DodCriterion[];
  onAdd: (values: CriterionValues) => void;
}) {
  const form = useItemForm<CriterionDraft, CriterionValues, CriterionField>({
    initial: EMPTY_CRITERION,
    validate: (d) => validateCriterion(d, criteria),
    onSave: onAdd,
  });
  const { draft, update, errors } = form;
  return (
    <ItemForm
      form={form}
      submitLabel="Add criterion"
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
        <Field label="Criterion" error={errors.label} required>
          {(props) => (
            <Input
              {...props}
              value={draft.label}
              maxLength={CRITERION_LABEL_MAX}
              onChange={(e) => update({ label: e.target.value })}
              placeholder="e.g. Tests pass in CI"
            />
          )}
        </Field>
        <Field label="Category">
          {(props) => (
            <Select
              value={draft.category}
              onValueChange={(v) => update({ category: v as DodCategory })}
            >
              <SelectTrigger {...props}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOD_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {DOD_CATEGORY_LABEL[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
      </div>
      <label className="flex min-h-9 items-center gap-2 text-sm text-text">
        <input
          type="checkbox"
          className="h-4 w-4 accent-[var(--accent)]"
          checked={draft.required}
          onChange={(e) => update({ required: e.target.checked })}
        />
        Required: every done story must meet it
      </label>
      <Field label="Description (optional)" error={errors.description}>
        {(props) => (
          <Textarea
            {...props}
            value={draft.description}
            maxLength={CRITERION_DESCRIPTION_MAX}
            rows={2}
            className="resize-none text-xs"
            onChange={(e) => update({ description: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                form.submit();
              }
            }}
          />
        )}
      </Field>
    </ItemForm>
  );
}
