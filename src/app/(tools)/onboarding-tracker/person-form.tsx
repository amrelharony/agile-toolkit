"use client";

import { useEffect } from "react";
import { UserPlus } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { PersonPicker } from "@/components/team/person-picker";
import { findRosterMember, nameKey, useTeamRoster } from "@/lib/team/use-team-roster";
import type { Validation } from "@/lib/utils/form";
import { isIsoDay } from "./model";

export const NAME_MAX = 80;

export interface PersonDraft {
  name: string;
  role: string;
  buddy: string;
  /** "YYYY-MM-DD": today to start; any day (they may have started weeks ago). */
  startDate: string;
  description: string;
}

export type PersonField = keyof PersonDraft;

export interface PersonValues {
  name: string;
  role?: string;
  buddy?: string;
  startDate: string;
  description?: string;
}

/**
 * A new joiner needs a name and a real start date. A blank name used to be
 * ignored with the Add button still enabled, and an emptied date silently
 * became today.
 */
export function validatePerson(d: PersonDraft): Validation<PersonValues, PersonField> {
  const errors: Partial<Record<PersonField, string>> = {};
  const name = d.name.replace(/\s+/g, " ").trim();
  const role = d.role.replace(/\s+/g, " ").trim();
  const buddy = d.buddy.replace(/\s+/g, " ").trim();
  const description = d.description.trim();
  if (!name) errors.name = "Who is joining?";
  else if (name.length > NAME_MAX) errors.name = `Keep the name to ${NAME_MAX} characters.`;
  if (buddy.length > NAME_MAX) errors.buddy = `Keep the name to ${NAME_MAX} characters.`;
  else if (buddy && name && nameKey(buddy) === nameKey(name))
    errors.buddy = "A buddy is someone else on the team.";
  if (!isIsoDay(d.startDate.trim())) errors.startDate = "Pick their start date.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: {
      name,
      startDate: d.startDate.trim(),
      ...(role ? { role } : {}),
      ...(buddy ? { buddy } : {}),
      ...(description ? { description } : {}),
    },
  };
}

/**
 * Add a new joiner, or edit one in place (`initial` + `onCancel`). The name
 * comes from the Team roster or is typed (adding them to the team is a
 * separate click); a roster member's role fills an empty Role field, in
 * view, so it can be changed.
 */
export function PersonForm({
  initial,
  submitLabel,
  onSave,
  onCancel,
  offerAddToRoster,
  focusOnOpen = false,
}: {
  initial: PersonDraft;
  submitLabel: string;
  onSave: (values: PersonValues) => void;
  onCancel?: () => void;
  offerAddToRoster: boolean;
  /** Focus the first field when it opens (an in-place edit replaces its trigger). */
  focusOnOpen?: boolean;
}) {
  const roster = useTeamRoster();
  const form = useItemForm<PersonDraft, PersonValues, PersonField>({
    initial,
    validate: validatePerson,
    onSave,
    resetOnSave: !onCancel,
  });
  const { draft, update, errors, formRef } = form;
  useEffect(() => {
    if (focusOnOpen)
      formRef.current?.querySelector<HTMLElement>("input, select, textarea")?.focus();
    // On open only: a re-render mustn't pull focus back to the first field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pickName = (name: string) => {
    const member = findRosterMember(roster, name);
    update(member?.role && !draft.role.trim() ? { name, role: member.role } : { name });
  };
  return (
    <ItemForm
      form={form}
      submitLabel={submitLabel}
      submitIcon={onCancel ? undefined : <UserPlus className="h-4 w-4" aria-hidden="true" />}
      onCancel={onCancel}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_11rem]">
        <PersonPicker
          label="Name"
          required
          value={draft.name}
          onChange={pickName}
          error={errors.name}
          placeholder="Jane Doe"
          offerAddToRoster={offerAddToRoster}
        />
        <Field label="Role">
          {(props) => (
            <Input
              {...props}
              value={draft.role}
              maxLength={NAME_MAX}
              onChange={(e) => update({ role: e.target.value })}
              placeholder="Software Engineer"
            />
          )}
        </Field>
        <Field label="Start date" required error={errors.startDate}>
          {(props) => (
            <Input
              {...props}
              type="date"
              value={draft.startDate}
              onChange={(e) => update({ startDate: e.target.value })}
            />
          )}
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <PersonPicker
          label="Buddy (optional)"
          value={draft.buddy}
          onChange={(buddy) => update({ buddy })}
          error={errors.buddy}
          placeholder="Who shows them around"
          offerAddToRoster={offerAddToRoster}
        />
        <Field label="Description (optional)">
          {(props) => (
            <Textarea
              {...props}
              value={draft.description}
              onChange={(e) => update({ description: e.target.value })}
              placeholder="Team, focus area, anything to remember"
              rows={2}
              className="resize-none text-xs"
            />
          )}
        </Field>
      </div>
    </ItemForm>
  );
}
