"use client";

import { useEffect } from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { PersonPicker } from "@/components/team/person-picker";
import type { Meeting } from "./model";
import { validateStart, type StartDraft, type StartField, type StartValues } from "./start-form";

/**
 * A 1:1's who, when and what, edited in place with the same checks as
 * Start: two different people and a real day. Escape or Cancel keeps it.
 */
export function DetailsForm({
  meeting,
  offerAddToRoster,
  onSave,
  onCancel,
}: {
  meeting: Meeting;
  offerAddToRoster: boolean;
  onSave: (values: StartValues) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<StartDraft, StartValues, StartField>({
    initial: () => ({
      manager: meeting.manager,
      report: meeting.report,
      date: meeting.date,
      description: meeting.description ?? "",
    }),
    validate: validateStart,
    onSave,
    resetOnSave: false,
  });
  const { draft, update, errors, formRef } = form;
  // It opens in place of "Edit details", so focus moves into it.
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("input, select, textarea")?.focus();
  }, [formRef]);
  return (
    <ItemForm form={form} submitLabel="Save details" onCancel={onCancel}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <PersonPicker
          label="Manager"
          required
          value={draft.manager}
          onChange={(manager) => update({ manager })}
          error={errors.manager}
          offerAddToRoster={offerAddToRoster}
        />
        <PersonPicker
          label="Report"
          required
          value={draft.report}
          onChange={(report) => update({ report })}
          error={errors.report}
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
            rows={2}
            className="resize-none text-sm"
          />
        )}
      </Field>
    </ItemForm>
  );
}
