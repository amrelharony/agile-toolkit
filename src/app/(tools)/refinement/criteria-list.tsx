"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { InlineItemEditor, useInlineEdit } from "@/components/shared/inline-item-editor";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Validation } from "@/lib/utils/form";
import { toast } from "@/lib/utils/toast";
import type { Criterion } from "./store";

interface CriterionDraft {
  label: string;
  description: string;
}

type CriterionField = "label";

const EMPTY: CriterionDraft = { label: "", description: "" };

/** A new criterion needs a label, and one the list doesn't have already. */
export function validateCriterion(
  draft: CriterionDraft,
  criteria: readonly Criterion[]
): Validation<{ label: string; description?: string }, CriterionField> {
  const label = draft.label.trim();
  if (!label) return { ok: false, errors: { label: "Enter the criterion." } };
  const key = label.toLowerCase();
  if (criteria.some((c) => c.label.trim().toLowerCase() === key)) {
    return { ok: false, errors: { label: "That criterion is already on the list." } };
  }
  const description = draft.description.trim();
  return { ok: true, values: { label, ...(description ? { description } : {}) } };
}

/**
 * The Definition of Ready: the one editable list of criteria. Each is
 * edited in place, deleted with Undo, and added through a form that saves
 * nothing until the criterion has a label (no "New criterion" rows).
 */
export function CriteriaList({
  criteria,
  onAdd,
  onEdit,
  onRemove,
}: {
  criteria: readonly Criterion[];
  onAdd: (label: string, description?: string) => void;
  onEdit: (id: string, label: string, description: string) => void;
  onRemove: (criterion: Criterion) => void;
}) {
  const form = useItemForm<CriterionDraft, { label: string; description?: string }, CriterionField>(
    {
      initial: EMPTY,
      validate: (d) => validateCriterion(d, criteria),
      onSave: (v) => onAdd(v.label, v.description),
    }
  );

  return (
    <div className="space-y-4">
      {criteria.length === 0 ? (
        <p className="text-sm text-sub">
          No criteria yet. Add the checks a story must pass before the team takes it into a sprint.
        </p>
      ) : (
        <ol aria-label="Definition of Ready criteria" className="space-y-2">
          {criteria.map((c, i) => (
            <CriterionRow
              key={c.id}
              criterion={c}
              index={i}
              onEdit={(label, description) => {
                // A rename meets the add form's rule: no two criteria alike.
                // The editor closes on save, so a clash keeps the old name and says why.
                const check = validateCriterion(
                  { label, description },
                  criteria.filter((x) => x.id !== c.id)
                );
                if (!check.ok) {
                  toast.error(`“${label.trim()}” is already on the list.`, {
                    description: `The criterion keeps its name, “${c.label}”.`,
                  });
                  return;
                }
                onEdit(c.id, check.values.label, check.values.description ?? "");
              }}
              onRemove={() => onRemove(c)}
            />
          ))}
        </ol>
      )}

      <ItemForm
        form={form}
        submitLabel="Add criterion"
        submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
        className="border-t border-border pt-4"
      >
        <Field label="New criterion" error={form.errors.label} required>
          {(props) => (
            <Input
              {...props}
              value={form.draft.label}
              onChange={(e) => form.update({ label: e.target.value })}
              placeholder="e.g. Test data identified"
            />
          )}
        </Field>
        <Field label="Description" hint="Optional: what counts as passing.">
          {(props) => (
            <Textarea
              {...props}
              rows={2}
              value={form.draft.description}
              onChange={(e) => form.update({ description: e.target.value })}
              className="resize-none text-sm"
            />
          )}
        </Field>
      </ItemForm>
    </div>
  );
}

function CriterionRow({
  criterion,
  index,
  onEdit,
  onRemove,
}: {
  criterion: Criterion;
  index: number;
  onEdit: (label: string, description: string) => void;
  onRemove: () => void;
}) {
  const edit = useInlineEdit();
  return (
    <li className="flex items-start gap-3 rounded-lg border border-border bg-surface-deep/40 p-3">
      <span className="mt-0.5 w-5 shrink-0 font-mono text-xs text-sub" aria-hidden="true">
        {index + 1}
      </span>
      {edit.editing ? (
        <InlineItemEditor
          label={`Edit ${criterion.label}`}
          title={criterion.label}
          description={criterion.description}
          withDescription
          titleLabel="Criterion"
          descriptionLabel="Criterion description"
          className="flex-1"
          onDone={(next, opts) => {
            if (next) onEdit(next.title, next.description ?? "");
            edit.stop(opts);
          }}
        />
      ) : (
        <>
          <div className="min-w-0 flex-1">
            <p className="break-words text-sm text-text">{criterion.label}</p>
            {criterion.description && (
              <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-sub">
                {criterion.description}
              </p>
            )}
          </div>
          <span className="flex shrink-0 items-center">
            <IconButton
              ref={edit.triggerRef}
              label={`Edit ${criterion.label}`}
              icon={<Pencil className="h-4 w-4" />}
              className="text-sub hover:text-text"
              onClick={edit.start}
            />
            <IconButton
              label={`Delete ${criterion.label}`}
              icon={<Trash2 className="h-4 w-4" />}
              className="text-sub hover:text-danger"
              onClick={onRemove}
            />
          </span>
        </>
      )}
    </li>
  );
}
