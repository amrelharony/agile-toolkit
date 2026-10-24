"use client";

/**
 * The typed snapshots' status columns: rename and describe in place, add
 * one (before Done, so the last column stays the done one), and remove
 * one (with Undo, from the page, which puts its counts back too).
 */

import { useState } from "react";
import { Plus, Settings2, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { BlurInput, BlurTextarea } from "@/components/shared/blur-fields";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { SectionCard } from "@/components/shared/section-card";
import type { Validation } from "@/lib/utils/form";
import type { StatusColumn } from "../types";
import { columnNameError } from "../form";
import { stageColors } from "../stage-colors";
import { typedWorkflow } from "../view";

interface ColumnDraft {
  name: string;
  description: string;
}

const KIND_BADGE = { queue: "waiting", active: "in progress", done: "done" } as const;

export function ColumnsCard({
  columns,
  onAdd,
  onRename,
  onDescribe,
  onRemove,
}: {
  columns: StatusColumn[];
  onAdd: (name: string, description?: string) => void;
  onRename: (column: StatusColumn, name: string) => void;
  onDescribe: (column: StatusColumn, description: string | undefined) => void;
  onRemove: (column: StatusColumn) => void;
}) {
  const stages = typedWorkflow(columns).stages;
  const colors = stageColors(stages);
  // Remounts a name field whose rename was refused, so it shows the saved name.
  const [nameKeys, setNameKeys] = useState<Record<string, number>>({});
  const [renameError, setRenameError] = useState<{ id: string; message: string } | null>(null);
  const form = useItemForm<ColumnDraft, ColumnDraft, "name">({
    initial: { name: "", description: "" },
    validate: (d): Validation<ColumnDraft, "name"> => {
      const err = columnNameError(d.name, columns);
      return err
        ? { ok: false, errors: { name: err } }
        : { ok: true, values: { name: d.name.trim(), description: d.description.trim() } };
    },
    onSave: (v) => onAdd(v.name, v.description || undefined),
  });

  return (
    <SectionCard title="Status columns" icon={Settings2}>
      <ul className="flex flex-col gap-2">
        {columns.map((col, idx) => {
          const kind = stages[idx].kind;
          return (
            <li
              key={col.id}
              className="flex flex-col gap-2 rounded-lg border border-border bg-surface-deep px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ background: colors[idx] }}
                  aria-hidden="true"
                />
                <BlurInput
                  key={nameKeys[col.id] ?? 0}
                  value={col.name}
                  onCommit={(v) => {
                    const err = columnNameError(v, columns, col.id);
                    if (err) {
                      setRenameError({ id: col.id, message: err });
                      setNameKeys((k) => ({ ...k, [col.id]: (k[col.id] ?? 0) + 1 }));
                      return;
                    }
                    setRenameError(null);
                    onRename(col, v.trim());
                  }}
                  aria-label={`Name of column ${idx + 1}`}
                  className="h-7 min-w-0 flex-1 bg-transparent border-none p-0 text-sm text-text focus:ring-0"
                />
                <Badge variant="outline" className="shrink-0 border-border text-xs text-sub">
                  {KIND_BADGE[kind]}
                </Badge>
                {columns.length > 2 && (
                  <IconButton
                    label={`Remove column ${col.name}`}
                    icon={<Trash2 aria-hidden="true" />}
                    onClick={() => onRemove(col)}
                    className="text-sub hover:text-danger"
                  />
                )}
              </div>
              {renameError?.id === col.id && (
                <p role="alert" className="text-xs text-danger">
                  {renameError.message}
                </p>
              )}
              <BlurTextarea
                value={col.description ?? ""}
                onCommit={(v) => onDescribe(col, v.trim() ? v.trim() : undefined)}
                placeholder="What this column means (optional)"
                rows={2}
                className="bg-surface border-border resize-none text-xs text-text"
                aria-label={`Description of ${col.name}`}
              />
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-sub">
        The first column is waiting work, the last is done, and the ones between count as work in
        progress. A new column goes before {columns[columns.length - 1]?.name ?? "Done"}.
      </p>
      <ItemForm
        form={form}
        submitLabel="Add column"
        submitIcon={<Plus aria-hidden="true" />}
        className="mt-3 max-w-md"
      >
        <Field label="New column" required error={form.errors.name}>
          {(p) => (
            <Input
              {...p}
              placeholder="e.g. Blocked"
              value={form.draft.name}
              onChange={(e) => form.update({ name: e.target.value })}
            />
          )}
        </Field>
        <Field label="Description" hint="Optional.">
          {(p) => (
            <Textarea
              {...p}
              rows={2}
              className="resize-none text-xs"
              value={form.draft.description}
              onChange={(e) => form.update({ description: e.target.value })}
            />
          )}
        </Field>
      </ItemForm>
    </SectionCard>
  );
}
