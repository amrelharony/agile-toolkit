"use client";

import { useEffect, useId, useRef } from "react";
import { Plus } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { useTeamRoster } from "@/lib/team/use-team-roster";
import type { Validation } from "@/lib/utils/form";
import { CATEGORY_LABELS, CATEGORY_MEANING, FEEDBACK_CATEGORIES } from "../constants";
import { isFeedbackCategory } from "../doc";
import type { FeedbackCategory, FeedbackItem } from "../types";

export interface FeedbackDraft {
  stakeholder: string;
  /** Unset until picked: a piece of feedback never lands in "Positive" by default. */
  category: FeedbackCategory | null;
  feedback: string;
}

export type FeedbackValues = Pick<FeedbackItem, "stakeholder" | "category" | "feedback">;
type FeedbackField = keyof FeedbackDraft;

/** The longest note the form takes; feedback is a line or two, not minutes. */
export const FEEDBACK_MAX = 1000;

export const EMPTY_FEEDBACK_DRAFT: FeedbackDraft = {
  stakeholder: "",
  category: null,
  feedback: "",
};

/** A draft from a stored item; a category that isn't one of the three is unset. */
export function feedbackDraftFrom(item: FeedbackItem): FeedbackDraft {
  return {
    stakeholder: item.stakeholder,
    category: isFeedbackCategory(item.category) ? item.category : null,
    feedback: item.feedback,
  };
}

/** Who said it, what kind of feedback and what they said are all required. */
export function validateFeedback(d: FeedbackDraft): Validation<FeedbackValues, FeedbackField> {
  const errors: Partial<Record<FeedbackField, string>> = {};
  const stakeholder = d.stakeholder.trim();
  const feedback = d.feedback.trim();
  if (!stakeholder) errors.stakeholder = "Enter who gave the feedback.";
  if (!d.category) errors.category = "Pick what kind of feedback it is.";
  if (!feedback) errors.feedback = "Write down what they said.";
  if (Object.keys(errors).length > 0 || !d.category) return { ok: false, errors };
  return { ok: true, values: { stakeholder, category: d.category, feedback } };
}

/**
 * The three categories as a radio group with no default. The wrapper
 * carries `data-scale-invalid`, so a save without one focuses the group
 * like a ScalePicker.
 */
function CategoryPicker({
  value,
  onChange,
  error,
}: {
  value: FeedbackCategory | null;
  onChange: (category: FeedbackCategory) => void;
  error?: string;
}) {
  const errorId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  // ToggleGroup takes no ARIA props, so mark its radio group required and
  // link the message here. Not aria-invalid: focusFirstInvalid would then
  // pick the group itself, which can't take focus, instead of its radio.
  useEffect(() => {
    const group = wrapRef.current?.querySelector('[role="radiogroup"]');
    if (!group) return;
    group.setAttribute("aria-required", "true");
    if (error) group.setAttribute("aria-describedby", errorId);
    else group.removeAttribute("aria-describedby");
  }, [error, errorId]);

  return (
    <div
      ref={wrapRef}
      className="flex min-w-0 flex-col gap-1.5"
      data-scale-invalid={error ? "true" : undefined}
    >
      {/* The radio group carries the name; this is the visible label. */}
      <span className="text-sm text-text" aria-hidden="true">
        Kind of feedback
        <span className="ml-0.5 text-danger">*</span>
      </span>
      <ToggleGroup
        label="Kind of feedback"
        options={FEEDBACK_CATEGORIES.map((c) => ({
          value: c,
          label: CATEGORY_LABELS[c],
          description: CATEGORY_MEANING[c],
        }))}
        value={value}
        onValueChange={onChange}
      />
      {error && (
        <p id={errorId} className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Who gave the feedback. Stakeholders are rarely on the team, so this is
 * not a PersonPicker: its "isn't on the team" note (and the nudge to fill
 * in the Team page) would flag almost every name here as a problem. The
 * roster's names are still suggested, for a team member who speaks up.
 */
function StakeholderField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (name: string) => void;
  error?: string;
}) {
  const roster = useTeamRoster();
  const listId = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Field label="Stakeholder" error={error} required>
        {(props) => (
          <Input
            {...props}
            list={listId}
            autoComplete="off"
            placeholder="e.g. Priya, Head of Payments"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
      </Field>
      <datalist id={listId}>
        {roster.map((m) => (
          <option key={m.id} value={m.name} />
        ))}
      </datalist>
    </div>
  );
}

function FeedbackFields({
  draft,
  update,
  errors,
}: {
  draft: FeedbackDraft;
  update: (patch: Partial<FeedbackDraft>) => void;
  errors: Partial<Record<FeedbackField, string>>;
}) {
  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <StakeholderField
          value={draft.stakeholder}
          onChange={(stakeholder) => update({ stakeholder })}
          error={errors.stakeholder}
        />
        <CategoryPicker
          value={draft.category}
          onChange={(category) => update({ category })}
          error={errors.category}
        />
      </div>
      <Field label="What they said" error={errors.feedback} required>
        {(props) => (
          <Textarea
            {...props}
            rows={2}
            maxLength={FEEDBACK_MAX}
            value={draft.feedback}
            onChange={(e) => update({ feedback: e.target.value })}
            placeholder="In their words, as far as you can"
            className="resize-none"
          />
        )}
      </Field>
    </>
  );
}

/** "Add feedback": nothing is recorded until all three are filled in. */
export function FeedbackAddForm({ onAdd }: { onAdd: (values: FeedbackValues) => void }) {
  const form = useItemForm<FeedbackDraft, FeedbackValues, FeedbackField>({
    initial: EMPTY_FEEDBACK_DRAFT,
    validate: validateFeedback,
    onSave: onAdd,
  });
  return (
    <ItemForm
      form={form}
      submitLabel="Add feedback"
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
    >
      <FeedbackFields draft={form.draft} update={form.update} errors={form.errors} />
    </ItemForm>
  );
}

/** Edit a piece of feedback in place. Enter saves, Escape cancels. */
export function FeedbackEditor({
  item,
  onSave,
  onCancel,
}: {
  item: FeedbackItem;
  onSave: (values: FeedbackValues) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<FeedbackDraft, FeedbackValues, FeedbackField>({
    initial: () => feedbackDraftFrom(item),
    validate: validateFeedback,
    onSave,
    resetOnSave: false,
  });
  const { formRef } = form;
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("input")?.focus();
  }, [formRef]);
  return (
    <ItemForm form={form} submitLabel="Save" onCancel={onCancel}>
      <FeedbackFields draft={form.draft} update={form.update} errors={form.errors} />
    </ItemForm>
  );
}
