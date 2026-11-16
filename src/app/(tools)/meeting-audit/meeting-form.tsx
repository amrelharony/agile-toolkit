"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { MEETING_CADENCES, TOOL_TEXT_MAX, type MeetingCadence } from "@/lib/stores/workspace-types";
import {
  ATTENDEES_MAX,
  CADENCE_LABEL,
  EMPTY_MEETING_DRAFT,
  MINUTES_MAX,
  validateMeetingDraft,
  weeklyText,
  weeklyHours,
  type MeetingDraft,
  type MeetingField,
  type MeetingValues,
} from "@/lib/meeting-audit/model";

/** How often it meets: one of the five cadences, required, with its error under it. */
function CadencePicker({
  value,
  onChange,
  error,
}: {
  value: MeetingCadence | null;
  onChange: (c: MeetingCadence) => void;
  error?: string;
}) {
  const id = useId();
  const errorId = error ? `${id}-error` : undefined;
  return (
    // focusFirstInvalid finds the group by this attribute after a failed save.
    <div className="flex min-w-0 flex-col gap-1.5" data-scale-invalid={error ? "true" : undefined}>
      <span className="text-sm text-text" aria-hidden="true">
        How often
        <span className="ml-0.5 text-danger">*</span>
      </span>
      <ToggleGroup<MeetingCadence>
        // The visible asterisk is hidden from screen readers: the name says it.
        label="How often (required)"
        size="sm"
        value={value}
        onValueChange={onChange}
        aria-describedby={errorId}
        options={MEETING_CADENCES.map((c) => ({ value: c, label: CADENCE_LABEL[c] }))}
      />
      {error && (
        <p id={errorId} className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** What the draft would cost, once its numbers are in: "≈ 7.5 person-hours a week". */
function costPreview(d: MeetingDraft): string | null {
  const minutes = Number(d.minutes);
  const attendees = Number(d.attendees);
  if (!d.cadence || !(minutes > 0) || !(attendees >= 1)) return null;
  return `≈ ${weeklyText(weeklyHours({ cadence: d.cadence, minutes, attendees }))}`;
}

/**
 * Add or edit one recurring meeting: its name, how often, how long, how many
 * people and what it's for (and, when editing, the notes on what to change).
 * Nothing is saved until the name and the numbers are in; a blank length is
 * an error, never 0.
 */
export function MeetingForm({
  initial = EMPTY_MEETING_DRAFT,
  submitLabel,
  submitIcon,
  onSave,
  onCancel,
  withNotes = false,
  autoFocus = false,
}: {
  initial?: MeetingDraft;
  submitLabel: string;
  submitIcon?: ReactNode;
  onSave: (values: MeetingValues) => void;
  onCancel?: () => void;
  /** Show the notes field (the edit form). */
  withNotes?: boolean;
  autoFocus?: boolean;
}) {
  const form = useItemForm<MeetingDraft, MeetingValues, MeetingField>({
    initial: () => initial,
    validate: validateMeetingDraft,
    onSave,
    resetOnSave: !withNotes,
  });
  const { draft, update, errors } = form;
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) nameRef.current?.focus();
  }, [autoFocus]);
  const cost = costPreview(draft);
  return (
    <ItemForm
      form={form}
      submitLabel={submitLabel}
      submitIcon={submitIcon}
      onCancel={onCancel}
      footer={
        cost ? (
          <p className="text-xs text-sub" aria-live="polite">
            {cost}
          </p>
        ) : null
      }
    >
      <Field label="Meeting" error={errors.meeting} required>
        {(props) => (
          <Input
            {...props}
            ref={nameRef}
            value={draft.meeting}
            maxLength={TOOL_TEXT_MAX.short}
            autoComplete="off"
            onChange={(e) => update({ meeting: e.target.value })}
            placeholder="e.g. Weekly status sync"
          />
        )}
      </Field>
      <CadencePicker
        value={draft.cadence}
        onChange={(cadence) => update({ cadence })}
        error={errors.cadence}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Minutes each time" error={errors.minutes} required>
          {(props) => (
            <Input
              {...props}
              type="number"
              inputMode="numeric"
              min={1}
              max={MINUTES_MAX}
              step={1}
              value={draft.minutes}
              onChange={(e) => update({ minutes: e.target.value })}
            />
          )}
        </Field>
        <Field label="People attending" error={errors.attendees} required>
          {(props) => (
            <Input
              {...props}
              type="number"
              inputMode="numeric"
              min={1}
              max={ATTENDEES_MAX}
              step={1}
              value={draft.attendees}
              onChange={(e) => update({ attendees: e.target.value })}
            />
          )}
        </Field>
      </div>
      <Field label="What it's for" error={errors.purpose} hint="One or two sentences.">
        {(props) => (
          <Textarea
            {...props}
            rows={2}
            value={draft.purpose}
            maxLength={TOOL_TEXT_MAX.text}
            onChange={(e) => update({ purpose: e.target.value })}
            placeholder="e.g. Agree the week's priorities with the stakeholders"
          />
        )}
      </Field>
      {withNotes && (
        <Field label="What to change" error={errors.notes}>
          {(props) => (
            <Textarea
              {...props}
              rows={3}
              value={draft.notes}
              maxLength={TOOL_TEXT_MAX.long}
              onChange={(e) => update({ notes: e.target.value })}
            />
          )}
        </Field>
      )}
    </ItemForm>
  );
}
