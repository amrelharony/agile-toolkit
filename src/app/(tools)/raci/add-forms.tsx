"use client";

import { Plus } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { PersonPicker } from "@/components/team/person-picker";
import { RACI_DESCRIPTION_MAX, RACI_NAME_MAX } from "@/lib/raci/model";
import { EMPTY_NAME, validateName, type NameDraft, type NameField, type NameValues } from "./form";

/**
 * "Add a column": a person from the roster (the column follows them), or a
 * group role such as "Dev Team" typed in. Adding someone to the team is
 * the picker's own explicit button, never a side effect.
 */
export function AddColumnForm({
  roles,
  offerAddToRoster,
  onAdd,
}: {
  roles: readonly { name: string }[];
  /** Never for the example: its people aren't the team's. */
  offerAddToRoster: boolean;
  onAdd: (values: NameValues) => void;
}) {
  const form = useItemForm<NameDraft, NameValues, NameField>({
    initial: EMPTY_NAME,
    validate: (d) => validateName(d, roles, "role"),
    onSave: onAdd,
  });
  const { draft, update, errors } = form;
  return (
    <ItemForm
      form={form}
      submitLabel="Add column"
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <PersonPicker
          label="Person or role"
          value={draft.name}
          onChange={(name) => update({ name })}
          error={errors.name}
          required
          placeholder="A teammate, or a group like Dev Team"
          offerAddToRoster={offerAddToRoster}
        />
        <Field label="Column description (optional)" error={errors.description}>
          {(props) => (
            <Input
              {...props}
              value={draft.description}
              maxLength={RACI_DESCRIPTION_MAX}
              onChange={(e) => update({ description: e.target.value })}
              placeholder="e.g. Product owner"
            />
          )}
        </Field>
      </div>
    </ItemForm>
  );
}

/** "Add an activity": a row of the matrix; nothing is saved until it has a name. */
export function AddActivityForm({
  activities,
  onAdd,
}: {
  activities: readonly { name: string }[];
  onAdd: (values: NameValues) => void;
}) {
  const form = useItemForm<NameDraft, NameValues, NameField>({
    initial: EMPTY_NAME,
    validate: (d) => validateName(d, activities, "activity"),
    onSave: onAdd,
  });
  const { draft, update, errors } = form;
  return (
    <ItemForm
      form={form}
      submitLabel="Add activity"
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Field label="Activity" error={errors.name} required>
          {(props) => (
            <Input
              {...props}
              value={draft.name}
              maxLength={RACI_NAME_MAX}
              onChange={(e) => update({ name: e.target.value })}
              placeholder="e.g. Release"
            />
          )}
        </Field>
        <Field label="Activity description (optional)" error={errors.description}>
          {(props) => (
            <Input
              {...props}
              value={draft.description}
              maxLength={RACI_DESCRIPTION_MAX}
              onChange={(e) => update({ description: e.target.value })}
            />
          )}
        </Field>
      </div>
    </ItemForm>
  );
}
