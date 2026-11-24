"use client";

import { useEffect, type KeyboardEvent, type ReactNode } from "react";
import { Send } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PersonPicker } from "@/components/team/person-picker";
import { ItemForm, useItemForm, type ItemFormState } from "@/components/shared/item-form";
import { ToggleGroup, type ToggleOption } from "@/components/ui/toggle-group";
import { BLOCKER_DRI_MAX, FORMAT_LABELS, formatOf } from "@/lib/standup/entries";
import type { StandupEntry, StandupFormat } from "@/lib/stores/workspace-types";
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

/** Whether the post form offers a hand-over, and to which place (Team Time knows the poster's). */
export interface HandoffOffer {
  show: boolean;
  /** The next place east to west, such as "Bengaluru". */
  to: string | null;
}

const TEXTAREA = "input-toolkit resize-y min-h-[4.5rem]";

/** The async form's two formats, by the three words each asks for. */
export const FORMAT_OPTIONS: ToggleOption<StandupFormat>[] = [
  {
    value: "classic",
    label: "Yesterday · Today · Blockers",
    description: "What you did, what you'll do, what's in the way",
  },
  {
    value: "ppp",
    label: "Progress · Plans · Problems",
    description: "What moved forward, what's next, what's stuck",
  },
];

const PLACEHOLDER: Record<StandupFormat, { done: string; next: string; problem: string }> = {
  classic: {
    done: "What did you complete yesterday?",
    next: "What will you work on today?",
    problem: "Anything in your way?",
  },
  ppp: {
    done: "What moved forward since your last update?",
    next: "What comes next?",
    problem: "What's stuck, or could go wrong?",
  },
};

/**
 * The update's text fields, shared by the post form and the in-place editor.
 * Every field is a textarea, where Enter starts a new line, so Ctrl/⌘+Enter
 * saves instead (as in the tools' other add forms). In async mode a typed
 * blocker asks who can clear it, and a hand-over field shows when Team
 * Time knows where the poster works.
 */
function TextFields({
  draft,
  update,
  errors,
  suggestion,
  onSubmit,
  format = "classic",
  asyncMode = false,
  handoff,
}: {
  draft: EntryDraft;
  update: (patch: Partial<EntryDraft>) => void;
  errors: Partial<Record<EntryField, string>>;
  suggestion?: YesterdaySuggestion | null;
  onSubmit: () => void;
  format?: StandupFormat;
  asyncMode?: boolean;
  handoff?: HandoffOffer;
}) {
  const suggested = Boolean(suggestion && draft.yesterday.trim() === suggestion.text.trim());
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    onSubmit();
  };
  const words = FORMAT_LABELS[format];
  const hint = PLACEHOLDER[format];
  return (
    <>
      <Field
        label={words.done}
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
            onKeyDown={onKeyDown}
            placeholder={hint.done}
            maxLength={ENTRY_TEXT_MAX}
            rows={2}
            className={TEXTAREA}
          />
        )}
      </Field>
      <Field label={words.next} error={errors.today} required>
        {(props) => (
          <Textarea
            {...props}
            value={draft.today}
            onChange={(e) => update({ today: e.target.value })}
            onKeyDown={onKeyDown}
            data-entry-field="today"
            placeholder={hint.next}
            maxLength={ENTRY_TEXT_MAX}
            rows={2}
            className={TEXTAREA}
          />
        )}
      </Field>
      <Field
        label={words.problem}
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
            onKeyDown={onKeyDown}
            placeholder={hint.problem}
            maxLength={ENTRY_TEXT_MAX}
            rows={2}
            className={`${TEXTAREA} ${draft.blockers.trim() ? "border-danger/40" : ""}`}
          />
        )}
      </Field>
      {asyncMode && draft.blockers.trim() && (
        <PersonPicker
          label="Who can clear it?"
          hint="The DRI: the one person who owns clearing it."
          value={draft.dri ?? ""}
          onChange={(name) => update({ dri: name.slice(0, BLOCKER_DRI_MAX) })}
          error={errors.dri}
          placeholder="Pick or type a name"
          offerAddToRoster={false}
        />
      )}
      {asyncMode && handoff?.show && (
        <Field
          label="Hand over to the next shift"
          error={errors.handoff}
          hint={
            handoff.to
              ? `${handoff.to} starts next: say what to pick up, and where it is.`
              : "What the next time zone should pick up, and where it is."
          }
        >
          {(props) => (
            <Textarea
              {...props}
              value={draft.handoff ?? ""}
              onChange={(e) => update({ handoff: e.target.value })}
              onKeyDown={onKeyDown}
              maxLength={ENTRY_TEXT_MAX}
              rows={2}
              className={TEXTAREA}
            />
          )}
        </Field>
      )}
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
            onKeyDown={onKeyDown}
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
  asyncMode = false,
  format = "classic",
  onFormatChange,
  handoff,
}: {
  form: ItemFormState<EntryDraft, EntryField>;
  today: string;
  submitLabel: string;
  suggestion?: YesterdaySuggestion | null;
  onMemberChange: (name: string) => void;
  onDateChange: (date: string) => void;
  footer?: ReactNode;
  /** The written standup: the format switch, the DRI and the hand-over. */
  asyncMode?: boolean;
  /** The format this browser posts in (async mode). */
  format?: StandupFormat;
  onFormatChange?: (format: StandupFormat) => void;
  handoff?: HandoffOffer;
}) {
  const { draft, update, errors } = form;
  const shown: StandupFormat = asyncMode ? format : "classic";
  return (
    <ItemForm
      form={form}
      submitLabel={submitLabel}
      submitIcon={<Send className="h-4 w-4" aria-hidden="true" />}
      footer={footer}
    >
      {asyncMode && onFormatChange && (
        <ToggleGroup
          label="Update format"
          size="sm"
          value={format}
          options={FORMAT_OPTIONS}
          onValueChange={onFormatChange}
          className="flex-wrap"
        />
      )}
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
      <TextFields
        draft={draft}
        update={update}
        errors={errors}
        suggestion={suggestion}
        onSubmit={() => form.submit()}
        format={shown}
        asyncMode={asyncMode}
        handoff={handoff}
      />
    </ItemForm>
  );
}

/**
 * Edit an entry in place: its text, not who, which day or its format (the
 * labels follow the entry's own). An async entry shows its DRI and
 * hand-over too. Ctrl/⌘+Enter (or Save) saves, Escape cancels.
 */
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
  const isAsync = entry.mode === "async";
  // Open on the first field, where the keyboard user was heading.
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("textarea")?.focus();
  }, [formRef]);
  return (
    <ItemForm
      form={form}
      submitLabel="Save"
      onCancel={onCancel}
      footer={<span className="text-xs text-sub">Ctrl/⌘+Enter saves, Esc cancels.</span>}
    >
      <TextFields
        draft={form.draft}
        update={form.update}
        errors={form.errors}
        onSubmit={() => form.submit()}
        format={formatOf(entry)}
        asyncMode={isAsync}
        handoff={{ show: isAsync, to: null }}
      />
    </ItemForm>
  );
}
