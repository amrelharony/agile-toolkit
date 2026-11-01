"use client";

import { Plus } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { Validation } from "@/lib/utils/form";
import { ITEM_TITLE_MAX } from "@/lib/hundred-dollar/allocation";

export interface ItemDraft {
  title: string;
}

/**
 * A new item needs a title of up to 200 characters (Buy-a-Feature's and
 * the backlog's cap): a blank one used to be ignored without a word.
 */
export function validateItem(d: ItemDraft): Validation<{ title: string }, "title"> {
  const title = d.title.trim();
  if (!title) return { ok: false, errors: { title: "Enter the item to vote on." } };
  if (title.length > ITEM_TITLE_MAX) {
    return { ok: false, errors: { title: `Keep it to ${ITEM_TITLE_MAX} characters or fewer.` } };
  }
  return { ok: true, values: { title } };
}

/** "Add item": Enter submits, errors show inline, nothing is added until it's valid. */
export function AddItemForm({
  disabled,
  onAdd,
}: {
  disabled?: boolean;
  onAdd: (title: string) => void;
}) {
  const form = useItemForm<ItemDraft, { title: string }, "title">({
    initial: { title: "" },
    validate: validateItem,
    onSave: (v) => onAdd(v.title),
  });
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="sr-only">Add an item</legend>
      <ItemForm form={form} submitLabel="Add item" submitIcon={<Plus aria-hidden="true" />}>
        <Field label="Item to vote on" error={form.errors.title}>
          {(props) => (
            <Input
              {...props}
              value={form.draft.title}
              onChange={(e) => form.update({ title: e.target.value })}
              placeholder="e.g. Offline mode"
            />
          )}
        </Field>
      </ItemForm>
    </fieldset>
  );
}
