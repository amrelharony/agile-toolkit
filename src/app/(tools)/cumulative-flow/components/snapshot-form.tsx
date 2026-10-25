"use client";

import { CalendarPlus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import type { DataEntry, StatusColumn } from "../types";
import { countField, emptySnapshot, validateSnapshot, type SnapshotDraft } from "../form";

/**
 * Draft-then-save for a typed snapshot: the date (backdatable, not in the
 * future, not one already used) and a count for every column, each typed.
 * Enter saves; a failed save says what's missing and focuses it.
 */
export function SnapshotForm({
  columns,
  entries,
  today,
  onAdd,
}: {
  columns: readonly StatusColumn[];
  entries: readonly DataEntry[];
  today: string;
  /** Saves the snapshot; false when its date was taken meanwhile. */
  onAdd: (entry: Omit<DataEntry, "id">) => void;
}) {
  const form = useItemForm<SnapshotDraft, Omit<DataEntry, "id">, string>({
    initial: () => emptySnapshot(today),
    validate: (draft) => validateSnapshot(draft, columns, entries, today),
    onSave: onAdd,
  });
  const { draft, update, errors } = form;
  return (
    <ItemForm
      form={form}
      submitLabel="Add snapshot"
      submitIcon={<CalendarPlus aria-hidden="true" />}
    >
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="Date" required error={errors.date} className="col-span-2 sm:col-span-1">
          {(p) => (
            <Input
              {...p}
              type="date"
              max={today}
              value={draft.date}
              onChange={(e) => update({ date: e.target.value })}
            />
          )}
        </Field>
        {columns.map((c) => (
          <Field key={c.id} label={c.name} required error={errors[countField(c.id)]}>
            {(p) => (
              <Input
                {...p}
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={draft.counts[c.id] ?? ""}
                onChange={(e) => update({ counts: { ...draft.counts, [c.id]: e.target.value } })}
              />
            )}
          </Field>
        ))}
      </div>
      <Field label="Note" hint="Optional: what happened that day.">
        {(p) => (
          <Input {...p} value={draft.note} onChange={(e) => update({ note: e.target.value })} />
        )}
      </Field>
    </ItemForm>
  );
}
