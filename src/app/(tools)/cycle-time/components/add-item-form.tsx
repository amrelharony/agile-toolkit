"use client";

import { Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import type { WorkItem } from "../types";
import { EMPTY_ITEM, ITEM_NAME_MAX, validateItem } from "../form";

/**
 * Draft-then-save for an item typed by hand: a name and both dates
 * (backdatable, not in the future, the finish not before the start).
 * Enter saves; nothing blank is ever stored.
 */
export function AddItemForm({
  today,
  onAdd,
}: {
  today: string;
  onAdd: (item: Omit<WorkItem, "id">) => void;
}) {
  const form = useItemForm({
    initial: EMPTY_ITEM,
    validate: (d) => validateItem(d, today),
    onSave: onAdd,
  });
  const { draft, update, errors } = form;
  return (
    <ItemForm form={form} submitLabel="Add item" submitIcon={<Plus aria-hidden="true" />}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Item" required error={errors.name} className="sm:col-span-3">
          {(p) => (
            <Input
              {...p}
              value={draft.name}
              maxLength={ITEM_NAME_MAX}
              placeholder="e.g. Checkout redesign"
              onChange={(e) => update({ name: e.target.value })}
            />
          )}
        </Field>
        <Field label="Started" required error={errors.startDate}>
          {(p) => (
            <Input
              {...p}
              type="date"
              max={today}
              value={draft.startDate}
              onChange={(e) => update({ startDate: e.target.value })}
            />
          )}
        </Field>
        <Field
          label="Finished"
          required
          hint="The same day as the start counts as 1 day."
          error={errors.endDate}
        >
          {(p) => (
            <Input
              {...p}
              type="date"
              max={today}
              value={draft.endDate}
              onChange={(e) => update({ endDate: e.target.value })}
            />
          )}
        </Field>
      </div>
    </ItemForm>
  );
}
