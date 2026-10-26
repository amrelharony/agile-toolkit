"use client";

import { Plus } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { PersonPicker } from "@/components/team/person-picker";
import { nameKey } from "@/lib/team/use-team-roster";
import type { Validation } from "@/lib/utils/form";
import { isIsoDay } from "./model";

/** How long a name can be. */
export const NAME_MAX = 80;

export interface StartDraft {
  manager: string;
  report: string;
  /** "YYYY-MM-DD": today to start, any day (a 1:1 can be logged late). */
  date: string;
  description: string;
}

export type StartField = keyof StartDraft;

export interface StartValues {
  manager: string;
  report: string;
  date: string;
  description?: string;
}

/**
 * Check a new 1:1: two different people and a real day. An emptied date
 * used to be saved as "" and the 1:1 sorted last for ever; a blank name
 * was silently ignored.
 */
export function validateStart(d: StartDraft): Validation<StartValues, StartField> {
  const errors: Partial<Record<StartField, string>> = {};
  const manager = d.manager.replace(/\s+/g, " ").trim();
  const report = d.report.replace(/\s+/g, " ").trim();
  const description = d.description.trim();
  if (!manager) errors.manager = "Who runs the 1:1?";
  else if (manager.length > NAME_MAX) errors.manager = `Keep the name to ${NAME_MAX} characters.`;
  if (!report) errors.report = "Who is the 1:1 with?";
  else if (report.length > NAME_MAX) errors.report = `Keep the name to ${NAME_MAX} characters.`;
  else if (manager && nameKey(manager) === nameKey(report))
    errors.report = "A 1:1 is between two people.";
  if (!isIsoDay(d.date.trim())) errors.date = "Pick the day of the 1:1.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: { manager, report, date: d.date.trim(), ...(description ? { description } : {}) },
  };
}

/**
 * "Start a 1:1": the people from the Team roster (or typed; adding to the
 * team is a separate click), the day, and what it's about. Enter saves;
 * nothing is created until both people and the day are set.
 */
export function StartForm({
  today,
  onStart,
  offerAddToRoster,
}: {
  today: string;
  onStart: (values: StartValues) => void;
  offerAddToRoster: boolean;
}) {
  const form = useItemForm<StartDraft, StartValues, StartField>({
    initial: () => ({ manager: "", report: "", date: today, description: "" }),
    validate: validateStart,
    onSave: onStart,
  });
  const { draft, update, errors } = form;
  return (
    <ItemForm
      form={form}
      submitLabel="Start meeting"
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <PersonPicker
          label="Manager"
          required
          value={draft.manager}
          onChange={(manager) => update({ manager })}
          error={errors.manager}
          placeholder="Who runs it"
          offerAddToRoster={offerAddToRoster}
        />
        <PersonPicker
          label="Report"
          required
          value={draft.report}
          onChange={(report) => update({ report })}
          error={errors.report}
          placeholder="Who it's with"
          offerAddToRoster={offerAddToRoster}
        />
        <Field label="Date" required error={errors.date}>
          {(props) => (
            <Input
              {...props}
              type="date"
              value={draft.date}
              onChange={(e) => update({ date: e.target.value })}
            />
          )}
        </Field>
      </div>
      <Field label="Description (optional)">
        {(props) => (
          <Textarea
            {...props}
            value={draft.description}
            onChange={(e) => update({ description: e.target.value })}
            placeholder="What's this 1:1 about?"
            rows={2}
            className="resize-none text-sm"
          />
        )}
      </Field>
    </ItemForm>
  );
}
