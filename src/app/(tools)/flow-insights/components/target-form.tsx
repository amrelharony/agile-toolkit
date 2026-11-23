"use client";

/**
 * The target mix: four whole numbers, one per kind of work, that add up to
 * 100 (or all four cleared for no target). It is the same target Kanban's
 * Definition of Workflow shows. Nothing is saved until the four add up.
 */

import { Target } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { WORK_TYPES } from "@/lib/stores/workspace-types";
import {
  WORK_TYPE_LABEL,
  WORK_TYPE_MEANING,
  validateTargetSplit,
  type TargetSplit,
  type TargetSplitField,
} from "@/lib/flow/work-types";

type Draft = Record<(typeof WORK_TYPES)[number], string>;

const draftOf = (target: TargetSplit | null): Draft => ({
  feature: target ? String(target.feature) : "",
  defect: target ? String(target.defect) : "",
  debt: target ? String(target.debt) : "",
  risk: target ? String(target.risk) : "",
});

export function TargetForm({
  target,
  onSave,
  onCancel,
}: {
  target: TargetSplit | null;
  /** A checked split, or null to clear the target. */
  onSave: (split: TargetSplit | null) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<Draft, TargetSplit | null, TargetSplitField>({
    initial: () => draftOf(target),
    validate: (d) => validateTargetSplit(d),
    onSave: (split) => onSave(split),
    resetOnSave: false,
  });
  const { draft, update, errors } = form;
  const sum = WORK_TYPES.reduce((n, t) => n + (Number(draft[t]) || 0), 0);

  return (
    <ItemForm
      form={form}
      submitLabel="Save target"
      submitIcon={<Target className="h-4 w-4" aria-hidden="true" />}
      onCancel={onCancel}
      footer={
        target ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onSave(null)}>
            Clear target
          </Button>
        ) : undefined
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {WORK_TYPES.map((t) => (
          <Field
            key={t}
            label={`${WORK_TYPE_LABEL[t]} %`}
            hint={WORK_TYPE_MEANING[t]}
            error={errors[t]}
          >
            {(props) => (
              <Input
                {...props}
                type="number"
                inputMode="numeric"
                min={0}
                max={100}
                step={1}
                value={draft[t]}
                onChange={(e) => update({ [t]: e.target.value } as Partial<Draft>)}
              />
            )}
          </Field>
        ))}
      </div>
      <p className="text-xs text-sub" aria-live="polite">
        Adds up to {sum}. Make the four add up to 100, or clear all four for no target.
      </p>
      {errors.total && (
        <p className="text-sm text-danger" role="alert">
          {errors.total}
        </p>
      )}
    </ItemForm>
  );
}
