"use client";

import { useEffect, type ReactNode } from "react";
import { Send } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PersonPicker } from "@/components/team/person-picker";
import { ItemForm, useItemForm, type ItemFormState } from "@/components/shared/item-form";
import type { StandupEntry } from "@/lib/stores/workspace-types";
import {
  ENTRY_TEXT_MAX,
  draftFrom,
  shortDay,
  validateEntry,
  type EntryDraft,
  type EntryField,
  type EntryValues,
} from "./model";

/** Where the "yesterday" suggestion came from: the person's last plan. */
export interface YesterdaySuggestion {
  date: string;
  text: string;
}

const TEXTAREA = "input-toolkit resize-y min-h-[4.5rem]";

/** The update's text fields, shared by the post form and the in-place editor. */
function TextFields({
  draft,
  update,
  errors,
  suggestion,
}: {
  draft: EntryDraft;
  update: (patch: Partial<EntryDraft>) => void;
  errors: Partial<Record<EntryField, string>>;
  suggestion?: YesterdaySuggestion | null;
}) {
  const suggested = Boolean(suggestion && draft.yesterday.trim() === suggestion.text.trim());
  return (
    <>
      <Field
        label="Yesterday"
        error={errors.yesterday}
        hint={
          suggested && suggestion
            ? `Filled in from the plan for ${shortDay(suggestion.date)}. Change it if plans changed.`
            : undefined
        }
      >
        {(props) => (
          <Textarea
            {...props}
            value={draft.yesterday}
            onChange={(e) => update({ yesterday: e.target.value })}
            placeholder="What did you complete yesterday?"
            maxLength={ENTRY_TEXT_MAX}
            rows={2}
            className={TEXTAREA}
          />
        )}
      </Field>
      <Field label="Today" error={errors.today} required>
        {(props) => (
          <Textarea
            {...props}
            value={draft.today}
            onChange={(e) => update({ today: e.target.value })}
            data-entry-field="today"
            placeholder="What will you work on today?"
            maxLength={ENTRY_TEXT_MAX}
            rows={2}
            className={TEXTAREA}
          />
        )}
      </Field>
      <Field
        label="Blockers"
        error={errors.blockers}
        hint={
          draft.blockers.trim()
            ? "Will be flagged in Blockers, ready to raise as an impediment."
            : "Leave blank if nothing is in the way."
        }
      >
        {(props) => (
          <Textarea
            {...props}
            value={draft.blockers}
            onChange={(e) => update({ blockers: e.target.value })}
            placeholder="Anything in your way?"
            maxLength={ENTRY_TEXT_MAX}
            rows={2}
            className={`${TEXTAREA} ${draft.blockers.trim() ? "border-danger/40" : ""}`}
          />
        )}
      </Field>
      <Field
        label="Notes"
        error={errors.notes}
        hint="Optional: anything else the team should know."
      >
        {(props) => (
          <Textarea
            {...props}
            value={draft.notes}
            onChange={(e) => update({ notes: e.target.value })}
            placeholder="e.g. Out from 3 pm"
            maxLength={ENTRY_TEXT_MAX}
            rows={2}
            className={TEXTAREA}
          />
        )}
      </Field>
    </>
  );
}

/** The post form's state; the client owns it so the walk and "Post for" can pick the person. */
export function useEntryForm(
  initial: () => EntryDraft,
  today: string,
  onSave: (values: EntryValues) => void
): ItemFormState<EntryDraft, EntryField> {
  return useItemForm<EntryDraft, EntryValues, EntryField>({
    initial,
    validate: (d) => validateEntry(d, today),
    onSave,
    // The client resets after the save lands: a "Replace entry?" question
    // in between keeps the draft if the user backs out.
    resetOnSave: false,
  });
}

/**
 * Post an update: who, which day (backdatable), yesterday, today, blockers
 * and notes. Nothing is saved until the person and today's plan are there.
 */
export function EntryForm({
  form,
  today,
  submitLabel,
  suggestion,
  onMemberChange,
  onDateChange,
  footer,
}: {
  form: ItemFormState<EntryDraft, EntryField>;
  today: string;
  submitLabel: string;
  suggestion?: YesterdaySuggestion | null;
  onMemberChange: (name: string) => void;
  onDateChange: (date: string) => void;
  footer?: ReactNode;
}) {
  const { draft, update, errors } = form;
  return (
    <ItemForm
      form={form}
      submitLabel={submitLabel}
      submitIcon={<Send className="h-4 w-4" aria-hidden="true" />}
      footer={footer}
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
        <PersonPicker
          label="Team member"
          value={draft.member}
          onChange={onMemberChange}
          error={errors.member}
          placeholder="Pick or type a name"
          required
        />
        <Field
          label="Day"
          error={errors.date}
          hint={draft.date && draft.date < today ? "Backdated." : undefined}
        >
          {(props) => (
            <Input
              {...props}
              type="date"
              max={today}
              value={draft.date}
              onChange={(e) => onDateChange(e.target.value)}
            />
          )}
        </Field>
      </div>
      <TextFields draft={draft} update={update} errors={errors} suggestion={suggestion} />
    </ItemForm>
  );
}

/** Edit an entry in place: its text, not who or which day. Enter saves, Escape cancels. */
export function EntryEditor({
  entry,
  today,
  onSave,
  onCancel,
}: {
  entry: StandupEntry;
  today: string;
  onSave: (values: EntryValues) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<EntryDraft, EntryValues, EntryField>({
    initial: () => draftFrom(entry),
    // An entry stored with a later day (a clock off by a day) still edits.
    validate: (d) => validateEntry(d, entry.date > today ? entry.date : today),
    onSave,
    resetOnSave: false,
  });
  const { formRef } = form;
  // Open on the first field, where the keyboard user was heading.
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("textarea")?.focus();
  }, [formRef]);
  return (
    <ItemForm form={form} submitLabel="Save" onCancel={onCancel}>
      <TextFields draft={form.draft} update={form.update} errors={form.errors} />
    </ItemForm>
  );
}
