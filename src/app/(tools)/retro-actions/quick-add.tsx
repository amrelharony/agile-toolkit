"use client";

import { Plus } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { PersonPicker } from "@/components/team/person-picker";
import { RETRO_CARD_MAX } from "@/lib/retro/board";
import type { NewRetroAction } from "@/lib/retro/actions";
import type { Validation } from "@/lib/utils/form";

/** How long an owner's name can be: the agent's limit (tool.retro_actions.add). */
export const OWNER_MAX = 60;

export interface QuickAddDraft {
  text: string;
  assignee: string;
  /** "YYYY-MM-DD", or "" for no due date. */
  dueDate: string;
}

export type QuickAddField = keyof QuickAddDraft;

export const EMPTY_QUICK_ADD: QuickAddDraft = { text: "", assignee: "", dueDate: "" };

/** A day as a date input gives it: "YYYY-MM-DD". */
export const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Check a quick-add draft. The action is required; owner and due date are
 * optional and stay unset when blank (no "TBD" owner, no default date).
 * A due date in the past is allowed: the action may be logged late.
 */
export function validateQuickAdd(d: QuickAddDraft): Validation<NewRetroAction, QuickAddField> {
  const errors: Partial<Record<QuickAddField, string>> = {};
  const text = d.text.replace(/\s*[\r\n]+\s*/g, " ").trim();
  const assignee = d.assignee.trim();
  const dueDate = d.dueDate.trim();
  if (!text) errors.text = "Say what the team will do.";
  else if (text.length > RETRO_CARD_MAX) errors.text = `Keep it to ${RETRO_CARD_MAX} characters.`;
  if (assignee.length > OWNER_MAX) errors.assignee = `Keep the name to ${OWNER_MAX} characters.`;
  if (dueDate && !ISO_DAY.test(dueDate)) errors.dueDate = "Pick a day, or leave it empty.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: {
      text,
      ...(assignee ? { assignee } : {}),
      ...(dueDate ? { dueDate } : {}),
    },
  };
}

/**
 * "Add action": an action agreed outside the retro meeting (in a 1:1, a
 * follow-up chat) without opening the board. Nothing is saved until the
 * action has words; Enter in a field adds it.
 */
export function QuickAddForm({
  onAdd,
  target,
  offerAddToRoster = true,
}: {
  onAdd: (values: NewRetroAction) => void;
  /** Where it will land, e.g. "Goes on the current retro." */
  target: string;
  /** Offer "Add to the team" for a name off the roster; never while the example is shown. */
  offerAddToRoster?: boolean;
}) {
  const form = useItemForm<QuickAddDraft, NewRetroAction, QuickAddField>({
    initial: EMPTY_QUICK_ADD,
    validate: validateQuickAdd,
    onSave: onAdd,
  });
  const { draft, update, errors } = form;
  return (
    <ItemForm
      form={form}
      submitLabel="Add action"
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
      footer={<p className="text-xs text-sub">{target}</p>}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_12rem] lg:grid-cols-[minmax(0,1fr)_12rem_10rem]">
        <Field label="Action" error={errors.text} required className="sm:col-span-2 lg:col-span-1">
          {(props) => (
            <Input
              {...props}
              value={draft.text}
              maxLength={RETRO_CARD_MAX}
              // Enter adds the action. On a phone the keyboard hides the
              // Add action button below, so its return key says so.
              enterKeyHint="done"
              onChange={(e) => update({ text: e.target.value })}
              placeholder="e.g. Pair on the flaky checkout tests"
            />
          )}
        </Field>
        <PersonPicker
          label="Owner"
          value={draft.assignee}
          onChange={(assignee) => update({ assignee })}
          error={errors.assignee}
          placeholder="Who will do it"
          offerAddToRoster={offerAddToRoster}
        />
        <Field label="Due date" error={errors.dueDate}>
          {(props) => (
            <Input
              {...props}
              type="date"
              value={draft.dueDate}
              onChange={(e) => update({ dueDate: e.target.value })}
            />
          )}
        </Field>
      </div>
    </ItemForm>
  );
}
