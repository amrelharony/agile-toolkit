"use client";

/**
 * The Custom card's form in the format picker: a name and 2 to 6 column
 * names. Nothing starts until the draft is valid; a failed start says what's
 * missing and focuses the first field to fix. Starting saves the format in
 * this browser, so it shows in the picker next time.
 */

import { useEffect, useRef } from "react";
import { Plus, X } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  CUSTOM_COLUMNS_MAX,
  CUSTOM_COLUMNS_MIN,
  CUSTOM_LABEL_MAX,
  CUSTOM_NAME_MAX,
  validateCustomFormat,
  type CustomFormatDraft,
  type CustomFormatField,
} from "@/lib/retro/custom-format";

/** Examples in the empty column fields; placeholders, never values. */
const EXAMPLES = ["Went well", "To improve", "Ideas", "Shout-outs", "Questions", "Risks"];

const EMPTY: CustomFormatDraft = { name: "", columns: ["", "", ""] };

export function CustomFormatEditor({
  id,
  onStart,
  onCancel,
}: {
  /** The form's id, for the Custom card's aria-controls. */
  id: string;
  onStart: (values: CustomFormatDraft) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<CustomFormatDraft, CustomFormatDraft, CustomFormatField>({
    initial: EMPTY,
    validate: validateCustomFormat,
    onSave: onStart,
  });
  const nameRef = useRef<HTMLInputElement>(null);
  const columnRefs = useRef<(HTMLInputElement | null)[]>([]);
  // Where focus goes after adding or removing a column.
  const focusColumn = useRef<number | null>(null);

  useEffect(() => nameRef.current?.focus(), []);
  useEffect(() => {
    if (focusColumn.current === null) return;
    columnRefs.current[focusColumn.current]?.focus();
    focusColumn.current = null;
  });

  const columns = form.draft.columns;
  const setColumn = (i: number, value: string) =>
    form.update({ columns: columns.map((c, j) => (j === i ? value : c)) });
  const addColumn = () => {
    if (columns.length >= CUSTOM_COLUMNS_MAX) return;
    focusColumn.current = columns.length;
    form.update({ columns: [...columns, ""] });
  };
  const removeColumn = (i: number) => {
    if (columns.length <= CUSTOM_COLUMNS_MIN) return;
    focusColumn.current = Math.min(i, columns.length - 2);
    form.update({ columns: columns.filter((_, j) => j !== i) });
  };

  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className="rounded-lg border border-border bg-card p-4 space-y-3"
    >
      <div className="space-y-1">
        <h3 id={`${id}-heading`} className="text-sm font-bold text-text">
          Your own columns
        </h3>
        <p className="text-xs text-sub">
          Name {CUSTOM_COLUMNS_MIN} to {CUSTOM_COLUMNS_MAX} columns. Each gets a colour from the
          app&apos;s palette. Starting the retro saves the format in this browser, so you can pick
          it again next time.
        </p>
      </div>
      <ItemForm form={form} submitLabel="Start retro" onCancel={onCancel}>
        <Field label="Format name" error={form.errors.name} className="max-w-sm">
          {(props) => (
            <Input
              {...props}
              ref={nameRef}
              value={form.draft.name}
              maxLength={CUSTOM_NAME_MAX * 2}
              onChange={(e) => form.update({ name: e.target.value })}
              placeholder="Our team retro"
              autoComplete="off"
            />
          )}
        </Field>
        <fieldset className="space-y-2">
          <legend className="text-sm text-text">Columns</legend>
          {form.errors.columns && (
            <p className="text-xs text-danger" role="alert">
              {form.errors.columns}
            </p>
          )}
          <ol className="space-y-2">
            {columns.map((value, i) => (
              <li key={i} className="flex items-end gap-2">
                <Field
                  label={`Column ${i + 1}`}
                  error={form.errors[`column${i}`]}
                  className="min-w-0 flex-1 max-w-sm"
                >
                  {(props) => (
                    <Input
                      {...props}
                      ref={(el) => {
                        columnRefs.current[i] = el;
                      }}
                      value={value}
                      maxLength={CUSTOM_LABEL_MAX * 2}
                      onChange={(e) => setColumn(i, e.target.value)}
                      placeholder={EXAMPLES[i] ?? ""}
                      autoComplete="off"
                    />
                  )}
                </Field>
                {columns.length > CUSTOM_COLUMNS_MIN && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeColumn(i)}
                    aria-label={`Remove column ${i + 1}`}
                    className="min-touch-coarse h-9 w-9 shrink-0 p-0 text-sub hover:text-danger"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </Button>
                )}
              </li>
            ))}
          </ol>
          {columns.length < CUSTOM_COLUMNS_MAX && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addColumn}
              className="min-touch-coarse gap-1"
            >
              <Plus className="h-4 w-4" aria-hidden="true" /> Add column
            </Button>
          )}
        </fieldset>
      </ItemForm>
    </section>
  );
}
