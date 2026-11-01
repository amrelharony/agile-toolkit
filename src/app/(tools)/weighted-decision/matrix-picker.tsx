"use client";

import { useId, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import type { WeightedMatrix } from "@/lib/stores/workspace-types";
import type { FormErrors, Validation } from "@/lib/utils/form";
import { DEFAULT_MATRIX_NAME, MATRIX_NAME_MAX, MATRIX_QUESTION_MAX } from "@/lib/weighted/model";
import { FieldInPlace } from "./field-in-place";

export interface MatrixDraft {
  name: string;
  question: string;
}

export interface NewMatrix {
  name: string;
  question?: string;
}

/** A matrix needs a name; the question (what's being decided) is optional. */
export function validateMatrix(d: MatrixDraft): Validation<NewMatrix, keyof MatrixDraft> {
  const errors: FormErrors<keyof MatrixDraft> = {};
  const name = d.name.trim();
  const question = d.question.trim();
  if (!name) errors.name = "Name the matrix.";
  else if (name.length > MATRIX_NAME_MAX) {
    errors.name = `Keep the name to ${MATRIX_NAME_MAX} characters.`;
  }
  if (question.length > MATRIX_QUESTION_MAX) {
    errors.question = `Keep the question to ${MATRIX_QUESTION_MAX} characters.`;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, values: { name, ...(question ? { question } : {}) } };
}

/** "New matrix": a name and, optionally, the question it answers. */
export function MatrixForm({
  onSave,
  onCancel,
}: {
  onSave: (values: NewMatrix) => void;
  onCancel?: () => void;
}) {
  const form = useItemForm<MatrixDraft, NewMatrix, keyof MatrixDraft>({
    initial: { name: "", question: "" },
    validate: validateMatrix,
    onSave,
  });
  const { draft, update, errors } = form;
  return (
    <ItemForm
      form={form}
      submitLabel="Create matrix"
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
      onCancel={onCancel}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Matrix name" required error={errors.name}>
          {(props) => (
            <Input
              {...props}
              value={draft.name}
              maxLength={MATRIX_NAME_MAX}
              placeholder="e.g. Feature-flag vendor"
              onChange={(e) => update({ name: e.target.value })}
            />
          )}
        </Field>
        <Field
          label="What are you deciding?"
          error={errors.question}
          hint="Becomes the decision record's title."
        >
          {(props) => (
            <Input
              {...props}
              value={draft.question}
              maxLength={MATRIX_QUESTION_MAX}
              placeholder="e.g. Which feature-flag service do we adopt?"
              onChange={(e) => update({ question: e.target.value })}
            />
          )}
        </Field>
      </div>
    </ItemForm>
  );
}

/**
 * Which matrix is open, and the open one's name and question, edited in
 * place. Matrices from before names (the default matrix) read as
 * "Untitled matrix" until someone names them. Deleting a matrix asks
 * first, since it takes its options and criteria with it (with Undo).
 */
export function MatrixPicker({
  matrices,
  selected,
  onSelect,
  onCreate,
  onRename,
  onQuestion,
  onDelete,
}: {
  matrices: readonly WeightedMatrix[];
  selected: WeightedMatrix | undefined;
  onSelect: (id: string) => void;
  onCreate: (values: NewMatrix) => void;
  onRename: (m: WeightedMatrix, name: string) => void;
  onQuestion: (m: WeightedMatrix, question: string) => void;
  onDelete: (m: WeightedMatrix) => void;
}) {
  const selectId = useId();
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        {matrices.length > 0 && (
          <div className="min-w-0 flex-1 sm:max-w-sm">
            <label htmlFor={selectId} className="mb-1 block text-xs font-medium text-sub">
              Matrix
            </label>
            <select
              id={selectId}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={selected?.id ?? ""}
              onChange={(e) => onSelect(e.target.value)}
            >
              {matrices.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name || DEFAULT_MATRIX_NAME}
                </option>
              ))}
            </select>
          </div>
        )}
        <Button
          type="button"
          variant={matrices.length === 0 ? "default" : "outline"}
          size="sm"
          className="gap-1"
          aria-expanded={creating}
          onClick={() => setCreating((c) => !c)}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New matrix
        </Button>
      </div>

      {creating && (
        <div className="rounded-lg border border-border bg-card p-3">
          <MatrixForm
            onSave={(values) => {
              setCreating(false);
              onCreate(values);
            }}
            onCancel={() => setCreating(false)}
          />
        </div>
      )}

      {selected && (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] sm:items-end">
          <FieldInPlace
            // A new matrix starts with its own field (and no error from the last one).
            key={`name-${selected.id}`}
            label="Name"
            value={selected.name}
            maxLength={MATRIX_NAME_MAX}
            check={(name) =>
              name ? null : `A matrix needs a name: it's still “${selected.name}”.`
            }
            onSave={(name) => onRename(selected, name)}
          />
          <FieldInPlace
            key={`question-${selected.id}`}
            label="What are you deciding?"
            hint="Becomes the decision record's title."
            value={selected.question ?? ""}
            maxLength={MATRIX_QUESTION_MAX}
            placeholder="e.g. Which vendor do we pick?"
            onSave={(question) => onQuestion(selected, question)}
          />
          <IconButton
            label={`Delete the matrix ${selected.name}`}
            icon={<Trash2 className="h-4 w-4" />}
            className="text-sub hover:text-danger"
            onClick={() => setConfirming(true)}
          />
          <ConfirmDialog
            open={confirming}
            onOpenChange={setConfirming}
            title={`Delete “${selected.name}”?`}
            description="Its options, criteria and scores go with it. You can undo this for a few seconds."
            confirmLabel="Delete matrix"
            onConfirm={() => {
              setConfirming(false);
              onDelete(selected);
            }}
          />
        </div>
      )}
    </div>
  );
}
