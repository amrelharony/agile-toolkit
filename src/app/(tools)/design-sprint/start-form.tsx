"use client";

import { useEffect } from "react";
import { Plus } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ItemForm, useItemForm, type ItemFormState } from "@/components/shared/item-form";
import { PersonPicker } from "@/components/team/person-picker";
import type { DesignSprintPlan } from "@/lib/stores/workspace-types";
import { designSprintDates } from "@/lib/design-sprint/day";
import { isIsoDate, type WorkingCalendar } from "@/lib/sprints/calendar";
import type { Validation } from "@/lib/utils/form";
import { DESCRIPTION_MAX, NAME_MAX, PERSON_MAX, dateRange } from "./doc";

/**
 * The sprint's name, start date, description and roles: the form that
 * starts a sprint, and the same fields edited in place later. Nothing is
 * saved without a name and a real start date; a cleared date is an error,
 * never today in disguise.
 */

export interface DetailsDraft {
  name: string;
  startDate: string;
  description: string;
  decider: string;
  facilitator: string;
}

export type DetailsField = keyof DetailsDraft;

export interface DetailsValues {
  name: string;
  startDate: string;
  description?: string;
  decider?: string;
  facilitator?: string;
}

/** A new sprint's form, its start date showing `today` (the user sees it and can change it). */
export function emptyDetails(today: string): DetailsDraft {
  return { name: "", startDate: today, description: "", decider: "", facilitator: "" };
}

export function detailsDraftFrom(plan: DesignSprintPlan): DetailsDraft {
  return {
    name: plan.name,
    startDate: plan.startDate,
    description: plan.description ?? "",
    decider: plan.decider ?? "",
    facilitator: plan.facilitator ?? "",
  };
}

export function validateDetails(d: DetailsDraft): Validation<DetailsValues, DetailsField> {
  const errors: Partial<Record<DetailsField, string>> = {};
  const name = d.name.trim();
  if (!name) errors.name = "Name the sprint.";
  else if (name.length > NAME_MAX) errors.name = `Keep the name under ${NAME_MAX} characters.`;

  const startDate = d.startDate.trim();
  if (!startDate) errors.startDate = "Pick the day the sprint starts.";
  else if (!isIsoDate(startDate)) errors.startDate = "Enter a real date.";

  const description = d.description.trim();
  if (description.length > DESCRIPTION_MAX) {
    errors.description = `Keep the description under ${DESCRIPTION_MAX} characters.`;
  }
  const decider = d.decider.trim();
  const facilitator = d.facilitator.trim();
  if (decider.length > PERSON_MAX) errors.decider = "That name is too long.";
  if (facilitator.length > PERSON_MAX) errors.facilitator = "That name is too long.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: {
      name,
      startDate,
      ...(description ? { description } : {}),
      ...(decider ? { decider } : {}),
      ...(facilitator ? { facilitator } : {}),
    },
  };
}

/** The plan with the edited details; a cleared description or role is removed. */
export function withDetails(plan: DesignSprintPlan, v: DetailsValues): DesignSprintPlan {
  const next: DesignSprintPlan = { ...plan, name: v.name, startDate: v.startDate };
  for (const key of ["description", "decider", "facilitator"] as const) {
    const value = v[key];
    if (value) next[key] = value;
    else delete next[key];
  }
  return next;
}

export function sameDetails(plan: DesignSprintPlan, v: DetailsValues): boolean {
  return (
    plan.name === v.name &&
    plan.startDate === v.startDate &&
    (plan.description || undefined) === v.description &&
    (plan.decider || undefined) === v.decider &&
    (plan.facilitator || undefined) === v.facilitator
  );
}

function DetailsFields({
  form,
  calendar,
  offerAddToRoster,
}: {
  form: ItemFormState<DetailsDraft, DetailsField>;
  calendar: WorkingCalendar;
  offerAddToRoster: boolean;
}) {
  const { draft, update, errors } = form;
  const dates = isIsoDate(draft.startDate) ? designSprintDates(draft.startDate, calendar) : [];
  const dateHint =
    dates.length > 0
      ? `Runs ${dateRange(dates)}, on the team's working days. Backdate it if the sprint has already started.`
      : "Day 1 is the first working day on or after it. Backdate it if the sprint has already started.";
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Sprint name" error={errors.name} required>
          {(props) => (
            <Input
              {...props}
              value={draft.name}
              onChange={(e) => update({ name: e.target.value })}
              placeholder="e.g. Onboarding redesign"
            />
          )}
        </Field>
        <Field label="Start date" hint={dateHint} error={errors.startDate} required>
          {(props) => (
            <Input
              {...props}
              type="date"
              className="font-data"
              value={draft.startDate}
              onChange={(e) => update({ startDate: e.target.value })}
            />
          )}
        </Field>
      </div>
      <Field
        label="Description"
        hint="The big question the sprint answers."
        error={errors.description}
      >
        {(props) => (
          <Textarea
            {...props}
            rows={2}
            className="resize-y"
            value={draft.description}
            onChange={(e) => update({ description: e.target.value })}
            // Enter in a textarea is a new line; Ctrl/Cmd+Enter saves, as in the other forms.
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                form.submit();
              }
            }}
          />
        )}
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PersonPicker
          label="Decider"
          hint="Makes the final calls, from the target to the winning sketch."
          value={draft.decider}
          onChange={(decider) => update({ decider })}
          error={errors.decider}
          placeholder="Name"
          offerAddToRoster={offerAddToRoster}
        />
        <PersonPicker
          label="Facilitator"
          hint="Runs the days and keeps time."
          value={draft.facilitator}
          onChange={(facilitator) => update({ facilitator })}
          error={errors.facilitator}
          placeholder="Name"
          offerAddToRoster={offerAddToRoster}
        />
      </div>
    </>
  );
}

/** "Start sprint": the five days with their default tasks, once the name and date are valid. */
export function StartSprintForm({
  today,
  calendar,
  onStart,
}: {
  today: string;
  calendar: WorkingCalendar;
  onStart: (values: DetailsValues) => void;
}) {
  const form = useItemForm<DetailsDraft, DetailsValues, DetailsField>({
    initial: () => emptyDetails(today),
    validate: validateDetails,
    onSave: onStart,
  });
  return (
    <ItemForm
      form={form}
      submitLabel="Start sprint"
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
    >
      <DetailsFields form={form} calendar={calendar} offerAddToRoster />
    </ItemForm>
  );
}

/** Edit the sprint's details in place. Enter saves, Escape cancels. */
export function DetailsEditor({
  plan,
  calendar,
  offerAddToRoster,
  onSave,
  onCancel,
}: {
  plan: DesignSprintPlan;
  calendar: WorkingCalendar;
  offerAddToRoster: boolean;
  onSave: (values: DetailsValues) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<DetailsDraft, DetailsValues, DetailsField>({
    initial: () => detailsDraftFrom(plan),
    validate: validateDetails,
    onSave,
    resetOnSave: false,
  });
  const { formRef } = form;
  // Open on the name, where the keyboard user was heading.
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("input")?.focus();
  }, [formRef]);
  return (
    <ItemForm form={form} submitLabel="Save details" onCancel={onCancel}>
      <DetailsFields form={form} calendar={calendar} offerAddToRoster={offerAddToRoster} />
    </ItemForm>
  );
}
