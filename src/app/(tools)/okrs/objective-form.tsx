"use client";

import { Check, Plus } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { QuarterPicker } from "@/components/shared/quarter-picker";
import { PersonPicker } from "@/components/team/person-picker";
import {
  DESCRIPTION_MAX,
  TITLE_MAX,
  validateObjective,
  type ObjectiveDraft,
  type ObjectiveField,
  type ObjectiveValues,
} from "./forms";

/**
 * "New objective", and the same fields to edit one in place. Nothing is
 * saved until the objective has words and a quarter; the owner is picked
 * from the team's roster (any name is still accepted).
 */
export function ObjectiveForm({
  initial,
  onSave,
  onCancel,
  submitLabel,
  quarters,
  offerAddToRoster = true,
}: {
  initial: ObjectiveDraft;
  onSave: (values: ObjectiveValues) => void;
  onCancel?: () => void;
  submitLabel: string;
  /** Quarters already in use, kept in the picker's list. */
  quarters: readonly string[];
  /** Offer "Add to the team" for a name off the roster; never on an example objective. */
  offerAddToRoster?: boolean;
}) {
  const form = useItemForm<ObjectiveDraft, ObjectiveValues, ObjectiveField>({
    initial,
    validate: validateObjective,
    onSave,
    resetOnSave: !onCancel,
  });
  const { draft, update, errors } = form;
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
        <Field label="Objective" error={errors.objective} required>
          {(props) => (
            <Input
              {...props}
              value={draft.objective}
              maxLength={TITLE_MAX}
              onChange={(e) => update({ objective: e.target.value })}
              placeholder="e.g. Make checkout effortless on mobile"
            />
          )}
        </Field>
        <QuarterPicker
          label="Quarter"
          value={draft.quarter}
          onChange={(quarter) => update({ quarter })}
          also={quarters}
          error={errors.quarter}
          required
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[14rem_minmax(0,1fr)]">
        <PersonPicker
          label="Owner"
          value={draft.owner}
          onChange={(owner) => update({ owner })}
          error={errors.owner}
          placeholder="Who answers for it"
          offerAddToRoster={offerAddToRoster}
        />
        <Field label="Description" error={errors.description}>
          {(props) => (
            <Textarea
              {...props}
              rows={2}
              value={draft.description}
              maxLength={DESCRIPTION_MAX}
              onChange={(e) => update({ description: e.target.value })}
              placeholder="Why it matters (optional)"
              className="resize-none"
            />
          )}
        </Field>
      </div>
    </ItemForm>
  );
}
