"use client";

import { useEffect, useId } from "react";
import { Check, Plus } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import type { KeyResultDirection } from "@/lib/stores/workspace-types";
import {
  DESCRIPTION_MAX,
  TITLE_MAX,
  UNIT_MAX,
  needsBaseline,
  validateKeyResult,
  type KeyResultDraft,
  type KeyResultField,
  type KeyResultValues,
} from "./forms";

const DIRECTIONS: { value: KeyResultDirection; label: string; description: string }[] = [
  {
    value: "increase",
    label: "Go up",
    description: "Sign-ups, adoption, revenue: more is better.",
  },
  { value: "decrease", label: "Go down", description: "Churn, errors, wait time: less is better." },
];

/**
 * "Add key result", and the same fields to edit one in place. The
 * direction starts unset (no silent "increase"), and the target is checked
 * against the baseline and the direction as they're typed once a save has
 * been tried. A key result saved before baselines existed may keep none
 * (`requireBaseline` false) while it goes up: its progress still counts
 * from 0. Going down, it needs one (forms needsBaseline).
 */
export function KeyResultForm({
  initial,
  onSave,
  onCancel,
  submitLabel,
  requireBaseline = true,
  autoFocus = false,
}: {
  initial: KeyResultDraft;
  onSave: (values: KeyResultValues) => void;
  onCancel?: () => void;
  submitLabel: string;
  requireBaseline?: boolean;
  /**
   * Opened by a click (Edit, Add key result): focus the title, as the
   * control that opened the form went with the row it replaced.
   */
  autoFocus?: boolean;
}) {
  const form = useItemForm<KeyResultDraft, KeyResultValues, KeyResultField>({
    initial,
    validate: (d) => validateKeyResult(d, { requireBaseline }),
    onSave,
    resetOnSave: !onCancel,
  });
  const { draft, update, errors, formRef } = form;
  useEffect(() => {
    if (autoFocus) formRef.current?.querySelector<HTMLElement>("input")?.focus();
  }, [autoFocus, formRef]);
  const directionErrorId = useId();
  const up = draft.direction === "increase";
  const down = draft.direction === "decrease";
  const baselineNeeded = needsBaseline(draft.direction, requireBaseline);
  return (
    <ItemForm
      form={form}
      submitLabel={submitLabel}
      submitIcon={
        onCancel ? (
          <Check className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Plus className="h-4 w-4" aria-hidden="true" />
        )
      }
      onCancel={onCancel}
    >
      <Field label="Key result" error={errors.title} required>
        {(props) => (
          <Input
            {...props}
            value={draft.title}
            maxLength={TITLE_MAX}
            onChange={(e) => update({ title: e.target.value })}
            placeholder="e.g. Card payments that fail"
          />
        )}
      </Field>
      <div
        className="flex min-w-0 flex-col gap-1.5"
        data-scale-invalid={errors.direction ? "true" : undefined}
      >
        <span className="text-sm text-text" aria-hidden="true">
          The number should
          <span className="ml-0.5 text-danger">*</span>
        </span>
        <ToggleGroup
          label="The number should"
          options={DIRECTIONS}
          value={draft.direction}
          onValueChange={(direction) => update({ direction })}
          aria-describedby={errors.direction ? directionErrorId : undefined}
        />
        {errors.direction && (
          <p id={directionErrorId} className="text-xs text-danger" role="alert">
            {errors.direction}
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field
          label="Baseline"
          hint={baselineNeeded ? "Where it starts." : "Blank: counted from 0, as before."}
          error={errors.baseline}
          required={baselineNeeded}
        >
          {(props) => (
            <Input
              {...props}
              type="number"
              inputMode="decimal"
              value={draft.baseline}
              onChange={(e) => update({ baseline: e.target.value })}
              className="font-data"
            />
          )}
        </Field>
        <Field
          label="Target"
          hint={up ? "Above the baseline." : down ? "Below the baseline." : undefined}
          error={errors.target}
          required
        >
          {(props) => (
            <Input
              {...props}
              type="number"
              inputMode="decimal"
              value={draft.target}
              onChange={(e) => update({ target: e.target.value })}
              className="font-data"
            />
          )}
        </Field>
        <Field
          label="Unit"
          hint="%, sign-ups, ms…"
          error={errors.unit}
          className="col-span-2 sm:col-span-1"
        >
          {(props) => (
            <Input
              {...props}
              value={draft.unit}
              maxLength={UNIT_MAX}
              onChange={(e) => update({ unit: e.target.value })}
            />
          )}
        </Field>
      </div>
      <Field label="Description" error={errors.description}>
        {(props) => (
          <Textarea
            {...props}
            rows={2}
            value={draft.description}
            maxLength={DESCRIPTION_MAX}
            onChange={(e) => update({ description: e.target.value })}
            placeholder="How it's measured (optional)"
            className="resize-none"
          />
        )}
      </Field>
    </ItemForm>
  );
}
