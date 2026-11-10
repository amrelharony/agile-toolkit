"use client";

import { useEffect, useRef } from "react";
import { Plus } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import {
  PASTE_STORIES_CAP,
  pasteSummary,
  pastedStories,
  storiesCount,
  validatePaste,
  type PasteDraft,
  type PasteField,
  type PasteValues,
} from "./view";

/**
 * "Paste stories": a list from a document or a tracker, one title per line,
 * becomes that many stories in one go (up to 200 a paste). They go to the
 * backlog unless the box below is ticked. The count under the field says
 * what the paste will add before anything is saved; the page adds them with
 * one Undo.
 */
export function PasteStories({
  initialText = "",
  sprintName,
  intoSprintFirst = false,
  onAdd,
  onClose,
}: {
  /** A list already pasted into the add-story field, to carry on from. */
  initialText?: string;
  /** The sprint the stories can go straight into; absent when it is closed. */
  sprintName?: string;
  /** Start with "into the sprint" ticked (the paste came from the sprint's own add field). */
  intoSprintFirst?: boolean;
  onAdd: (values: PasteValues) => void;
  onClose: () => void;
}) {
  const form = useItemForm<PasteDraft, PasteValues, PasteField>({
    initial: { text: initialText, intoSprint: intoSprintFirst && sprintName !== undefined },
    validate: validatePaste,
    onSave: (values) => {
      onAdd(values);
      onClose();
    },
  });
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => field.current?.focus(), []);

  const pasted = pastedStories(form.draft.text);
  const count = pasted.titles.length;
  const where = form.draft.intoSprint && sprintName ? sprintName : "the backlog";

  return (
    <section
      aria-label="Paste stories"
      className="rounded-lg border border-border bg-surface/40 p-3"
    >
      <ItemForm
        form={form}
        submitLabel={count > 0 ? `Add ${storiesCount(count)} to ${where}` : `Add to ${where}`}
        submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
        onCancel={onClose}
      >
        <Field
          label="Stories to add"
          hint={`One title per line, up to ${PASTE_STORIES_CAP} lines. List marks such as "-" or "1." are removed.`}
          error={form.errors.text}
        >
          {(control) => (
            <Textarea
              {...control}
              ref={field}
              rows={6}
              value={form.draft.text}
              placeholder={"Pay with a saved card\nRemove a saved card"}
              onChange={(e) => form.update({ text: e.target.value })}
            />
          )}
        </Field>
        <p aria-live="polite" className="min-h-4 text-xs text-sub">
          {pasteSummary(pasted)}
        </p>
        {sprintName && (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-text pointer-coarse:min-h-11">
            <input
              type="checkbox"
              className="h-4 w-4 shrink-0 accent-[var(--accent)]"
              checked={form.draft.intoSprint}
              onChange={(e) => form.update({ intoSprint: e.target.checked })}
            />
            Put them straight into {sprintName}
          </label>
        )}
      </ItemForm>
    </section>
  );
}
