"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { PersonPicker } from "@/components/team/person-picker";
import type { Validation } from "@/lib/utils/form";
import type { AdkarInitiative } from "@/lib/stores/workspace-types";
import {
  DESCRIPTION_MAX,
  NAME_MAX,
  nameError,
  startDateError,
  type NewInitiative,
} from "@/lib/adkar/model";

export interface InitiativeDraft {
  name: string;
  owner: string;
  /** "YYYY-MM-DD". */
  startDate: string;
  description: string;
}

export type InitiativeField = keyof InitiativeDraft;

export const emptyInitiative = (today: string): InitiativeDraft => ({
  name: "",
  owner: "",
  startDate: today,
  description: "",
});

export const draftFrom = (i: AdkarInitiative): InitiativeDraft => ({
  name: i.name,
  owner: i.owner ?? "",
  startDate: i.startDate,
  description: i.description ?? "",
});

/**
 * Check an initiative: a name, a start day that exists and isn't after
 * today (or, for one being edited, after its first stage move). It used to
 * drop a blank name without a word and turn a cleared date into today.
 */
export function validateInitiative(
  d: InitiativeDraft,
  today: string,
  editing: AdkarInitiative | null = null
): Validation<NewInitiative, InitiativeField> {
  const errors: Partial<Record<InitiativeField, string>> = {};
  const name = nameError(d.name);
  if (name) errors.name = name;
  const start = startDateError(editing, d.startDate, today);
  if (start) errors.startDate = start;
  if (d.owner.trim().length > 120) errors.owner = "Keep the name to 120 characters.";
  if (d.description.trim().length > DESCRIPTION_MAX) {
    errors.description = `Keep it to ${DESCRIPTION_MAX} characters.`;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const owner = d.owner.trim();
  const description = d.description.trim();
  return {
    ok: true,
    values: {
      name: d.name.trim(),
      startDate: d.startDate,
      ...(owner ? { owner } : {}),
      ...(description ? { description } : {}),
    },
  };
}

/**
 * The add or edit form for an initiative: draft-then-save, Enter saves,
 * the owner picked from the roster (adding someone to the team is a
 * separate click), and a start day that can be backdated. `autoFocus`
 * (edit in place) puts focus on the name when it opens, where the Edit
 * button that opened it was.
 */
export function InitiativeForm({
  today,
  editing = null,
  onSave,
  onCancel,
  submitLabel,
  submitIcon,
  offerAddToRoster,
  autoFocus = false,
}: {
  today: string;
  editing?: AdkarInitiative | null;
  onSave: (values: NewInitiative) => void;
  onCancel?: () => void;
  submitLabel: string;
  submitIcon?: ReactNode;
  offerAddToRoster: boolean;
  autoFocus?: boolean;
}) {
  const form = useItemForm<InitiativeDraft, NewInitiative, InitiativeField>({
    initial: () => (editing ? draftFrom(editing) : emptyInitiative(today)),
    validate: (d) => validateInitiative(d, today, editing),
    onSave,
    resetOnSave: !editing,
  });
  const { draft, update, errors } = form;
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) nameRef.current?.focus();
  }, [autoFocus]);
  return (
    <ItemForm form={form} submitLabel={submitLabel} submitIcon={submitIcon} onCancel={onCancel}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_14rem_11rem]">
        <Field
          label="Initiative"
          error={errors.name}
          required
          className="sm:col-span-2 lg:col-span-1"
        >
          {(props) => (
            <Input
              {...props}
              ref={nameRef}
              value={draft.name}
              maxLength={NAME_MAX}
              onChange={(e) => update({ name: e.target.value })}
              placeholder="e.g. Adopt trunk-based development"
            />
          )}
        </Field>
        <PersonPicker
          label="Owner"
          value={draft.owner}
          onChange={(owner) => update({ owner })}
          error={errors.owner}
          placeholder="Who leads it (optional)"
          offerAddToRoster={offerAddToRoster}
        />
        <Field label="Start date" error={errors.startDate} required>
          {(props) => (
            <Input
              {...props}
              type="date"
              max={today}
              value={draft.startDate}
              onChange={(e) => update({ startDate: e.target.value })}
            />
          )}
        </Field>
      </div>
      <Field label="Description" error={errors.description}>
        {(props) => (
          <Textarea
            {...props}
            value={draft.description}
            maxLength={DESCRIPTION_MAX}
            rows={2}
            onChange={(e) => update({ description: e.target.value })}
            placeholder="Optional: what changes, and for whom"
            className="resize-none"
          />
        )}
      </Field>
    </ItemForm>
  );
}
