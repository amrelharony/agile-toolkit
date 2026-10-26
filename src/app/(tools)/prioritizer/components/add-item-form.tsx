"use client";

/**
 * "Add item": a name (required) and a description, nothing else. Every
 * method starts Not scored and the item isn't ordered until the next
 * Decide order, so a new item never lands in a bucket or a quadrant by
 * default. Enter adds; a name the backlog already has is pointed out (two
 * items may share one on purpose, so it's a note, not an error).
 */

import { Plus } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { BacklogItem } from "@/lib/stores/workspace-types";
import {
  EMPTY_NEW_ITEM,
  NAME_MAX,
  sameNameItem,
  validateNewItem,
  type NewItemDraft,
  type NewItemValues,
} from "../hub-form";
import { itemName } from "../method-text";

export function AddItemForm({
  items,
  onAdd,
}: {
  items: readonly BacklogItem[];
  onAdd: (values: NewItemValues) => void;
}) {
  const form = useItemForm<NewItemDraft, NewItemValues, keyof NewItemDraft>({
    initial: EMPTY_NEW_ITEM,
    validate: validateNewItem,
    onSave: onAdd,
  });
  const twin = sameNameItem(items, form.draft.name);
  return (
    <ItemForm
      form={form}
      submitLabel="Add item"
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field
          label="Item"
          required
          error={form.errors.name}
          hint={
            twin
              ? `“${itemName(twin.name, 60)}” is already on the backlog; adding makes a second item.`
              : "Every method starts Not scored: score it below or in a method's tool."
          }
        >
          {(props) => (
            <Input
              {...props}
              value={form.draft.name}
              maxLength={NAME_MAX + 20}
              onChange={(e) => form.update({ name: e.target.value })}
              placeholder="e.g. Guest checkout without an account"
            />
          )}
        </Field>
        <Field label="Description" hint="Optional.">
          {(props) => (
            <Textarea
              {...props}
              rows={1}
              value={form.draft.description}
              onChange={(e) => form.update({ description: e.target.value })}
              className="min-h-9 resize-y"
            />
          )}
        </Field>
      </div>
    </ItemForm>
  );
}
