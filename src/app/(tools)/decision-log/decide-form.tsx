"use client";

import { CheckCircle2 } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { PersonPicker } from "@/components/team/person-picker";
import type { Decision, TeamMember } from "@/lib/stores/workspace-types";
import {
  DECISION_TEXT_MAX,
  decideError,
  optionsOf,
  templateOf,
  type DecideInput,
} from "@/lib/decisions/model";
import { TEMPLATES } from "@/lib/decisions/templates";
import { findRosterMember } from "@/lib/team/names";
import type { FormErrors, Validation } from "@/lib/utils/form";
import { decidedDayError } from "./view";

export interface DecideDraft {
  outcome: string;
  /** An option id, or "" for none. */
  chosenOptionId: string;
  decider: string;
  date: string;
}

type DecideField = keyof DecideDraft;

/**
 * Check a decision being recorded: the outcome is required, DACI and RAPID
 * need their decider (lib/decisions decideError), and the day can be
 * backdated to the day it was raised but not set in the future.
 */
export function validateDecide(
  d: Decision,
  draft: DecideDraft,
  today: string,
  roster: readonly TeamMember[] = []
): Validation<DecideInput, DecideField> {
  const decider = draft.decider.trim()
    ? (findRosterMember(roster, draft.decider)?.name ?? draft.decider.trim())
    : undefined;
  const input: DecideInput = {
    outcome: draft.outcome,
    ...(draft.chosenOptionId ? { chosenOptionId: draft.chosenOptionId } : {}),
    ...(decider ? { decider } : {}),
    date: draft.date,
  };
  const errors: FormErrors<DecideField> = {};
  const day = decidedDayError(draft.date, d.date, today);
  if (day) errors.date = day;
  const outcome = draft.outcome.trim();
  if (!outcome) errors.outcome = "Write down what was decided.";
  else if (outcome.length > DECISION_TEXT_MAX) {
    errors.outcome = `Keep the outcome to ${DECISION_TEXT_MAX} characters.`;
  }
  const spec = TEMPLATES[templateOf(d)];
  if (spec.deciderRequiredToDecide && !decider && !d.decider?.trim()) {
    errors.decider = `Name the ${spec.deciderLabel} before deciding.`;
  }
  if (input.chosenOptionId && !optionsOf(d).some((o) => o.id === input.chosenOptionId)) {
    errors.chosenOptionId = "Pick one of the record's options.";
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  // The model's own check, so the page can never accept what the agent would refuse.
  const why = decideError(d, input);
  return why ? { ok: false, errors: { outcome: why } } : { ok: true, values: input };
}

/**
 * "Record the decision": what was decided, the option it picked, who made
 * the call and when. Saving accepts the record (lib/decisions decide).
 */
export function DecideForm({
  decision: d,
  today,
  roster,
  offerAddToRoster,
  onSave,
  onCancel,
}: {
  decision: Decision;
  today: string;
  roster: readonly TeamMember[];
  offerAddToRoster: boolean;
  onSave: (input: DecideInput) => void;
  onCancel: () => void;
}) {
  const spec = TEMPLATES[templateOf(d)];
  const options = optionsOf(d);
  const form = useItemForm<DecideDraft, DecideInput, DecideField>({
    initial: () => ({
      outcome: d.decision,
      chosenOptionId: d.chosenOptionId ?? "",
      decider: d.decider ?? "",
      date: today < d.date ? d.date : today,
    }),
    validate: (draft) => validateDecide(d, draft, today, roster),
    onSave: (input) => onSave(input),
    resetOnSave: false,
  });
  const { draft, update, errors } = form;

  return (
    <ItemForm
      form={form}
      submitLabel="Record the decision"
      submitIcon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
      onCancel={onCancel}
      className="rounded-md border border-border bg-surface-deep p-3"
    >
      <Field
        label="What was decided"
        required
        error={errors.outcome}
        hint="Write it as the team will act on it: “We will …”."
      >
        {(props) => (
          <Textarea
            {...props}
            rows={3}
            maxLength={DECISION_TEXT_MAX}
            value={draft.outcome}
            onChange={(e) => update({ outcome: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                form.submit();
              }
            }}
          />
        )}
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        {options.length > 0 && (
          <Field label="Option chosen" error={errors.chosenOptionId}>
            {(props) => (
              <select
                {...props}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={draft.chosenOptionId}
                onChange={(e) => update({ chosenOptionId: e.target.value })}
              >
                <option value="">None of them</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.text}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        <Field label="Decided on" error={errors.date}>
          {(props) => (
            <Input
              {...props}
              type="date"
              min={d.date || undefined}
              max={today}
              value={draft.date}
              onChange={(e) => update({ date: e.target.value })}
            />
          )}
        </Field>
      </div>
      <PersonPicker
        label={spec.deciderLabel}
        value={draft.decider}
        onChange={(decider) => update({ decider })}
        error={errors.decider}
        required={spec.deciderRequiredToDecide}
        hint="Who made the call."
        offerAddToRoster={offerAddToRoster}
      />
    </ItemForm>
  );
}
