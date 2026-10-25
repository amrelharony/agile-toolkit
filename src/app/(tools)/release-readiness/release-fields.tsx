"use client";

/**
 * A release's fields, shared by "Add a release" and the editor: its name,
 * the day it's planned to ship (required, never filled in, can be in the
 * past) and an optional description. Nothing is cut short as it's typed:
 * an over-long name gets an error instead.
 */

import type { ItemFormState } from "@/components/shared/item-form";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ReleaseDraft, ReleaseField } from "./form";

export function ReleaseFields({
  form,
  label,
}: {
  form: ItemFormState<ReleaseDraft, ReleaseField>;
  /** Names the group of fields, e.g. "Edit v3.4". */
  label?: string;
}) {
  const { draft, update, errors } = form;
  return (
    <div
      role="group"
      aria-label={label}
      className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]"
    >
      <Field label="Name" error={errors.name} required>
        {(props) => (
          <Input
            {...props}
            value={draft.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder="e.g. v3.4 Checkout redesign"
          />
        )}
      </Field>
      <Field label="Planned date" error={errors.plannedDate} required>
        {(props) => (
          <Input
            {...props}
            type="date"
            className="font-data"
            value={draft.plannedDate}
            onChange={(e) => update({ plannedDate: e.target.value })}
          />
        )}
      </Field>
      <Field label="Description" error={errors.description} className="sm:col-span-2">
        {(props) => (
          <Textarea
            {...props}
            rows={2}
            className="resize-none text-sm"
            value={draft.description}
            onChange={(e) => update({ description: e.target.value })}
            placeholder="Scope, audience, rollout plan…"
          />
        )}
      </Field>
    </div>
  );
}
