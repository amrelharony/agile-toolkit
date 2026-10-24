"use client";

import { Plus } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { Validation } from "@/lib/utils/form";

export interface CauseDraft {
  text: string;
}

/** A cause needs its text; ratings come later, in the Act phase, so nobody anchors on a number now. */
export function validateCause(d: CauseDraft): Validation<{ text: string }, "text"> {
  const text = d.text.replace(/\s*[\r\n]+\s*/g, " ").trim();
  return text
    ? { ok: true, values: { text } }
    : { ok: false, errors: { text: "Write the reason it failed." } };
}

/**
 * The quick add for silent writing: one line, Enter adds it and the field
 * is empty and focused for the next one. Nothing is saved blank.
 */
export function CauseAddForm({ onAdd }: { onAdd: (text: string) => void }) {
  const form = useItemForm<CauseDraft, { text: string }, "text">({
    initial: { text: "" },
    validate: validateCause,
    onSave: ({ text }) => onAdd(text),
  });
  return (
    <ItemForm
      form={form}
      submitLabel="Add cause"
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
    >
      <Field
        label="A reason it failed"
        hint="One reason per line. Write as many as you can; they stay hidden until you move on."
        error={form.errors.text}
        required
      >
        {(props) => (
          <Input
            {...props}
            value={form.draft.text}
            maxLength={300}
            enterKeyHint="enter"
            autoComplete="off"
            onChange={(e) => form.update({ text: e.target.value })}
            placeholder="e.g. The payment integration took twice as long as planned"
          />
        )}
      </Field>
    </ItemForm>
  );
}
