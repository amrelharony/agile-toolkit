"use client";

import { useEffect } from "react";
import { Plus } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { parseNumber, type Validation } from "@/lib/utils/form";
import { MAX_DEMO_MINUTES } from "../constants";
import { demoMinutes } from "../doc";
import type { DemoFeature } from "../types";

export interface DemoDraft {
  name: string;
  /** As typed; blank means "not timed yet". */
  minutes: string;
  description: string;
  acceptanceCriteria: string;
}

export type DemoValues = Omit<DemoFeature, "id">;
type DemoField = keyof DemoDraft;

export const EMPTY_DEMO_DRAFT: DemoDraft = {
  name: "",
  minutes: "",
  description: "",
  acceptanceCriteria: "",
};

/** A draft from a stored demo item (an old blank row's 0 minutes reads as not timed). */
export function demoDraftFrom(f: DemoFeature): DemoDraft {
  const m = demoMinutes(f);
  return {
    name: f.name,
    minutes: m === null ? "" : String(m),
    description: f.description,
    acceptanceCriteria: f.acceptanceCriteria,
  };
}

/**
 * Check a demo item. The name is required; the time is optional (an item
 * not timed yet stores 0 and shows as such, never a made-up 5 minutes),
 * and when typed it is whole minutes within a working day.
 */
export function validateDemo(d: DemoDraft): Validation<DemoValues, DemoField> {
  const errors: Partial<Record<DemoField, string>> = {};
  const name = d.name.trim();
  if (!name) errors.name = "Name what you'll demo.";
  const minutes = parseNumber(d.minutes);
  if (
    minutes !== undefined &&
    (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_DEMO_MINUTES)
  ) {
    errors.minutes = `Enter whole minutes from 1 to ${MAX_DEMO_MINUTES}, or leave it blank.`;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: {
      name,
      timeMinutes: minutes ?? 0,
      description: d.description.trim(),
      acceptanceCriteria: d.acceptanceCriteria.trim(),
    },
  };
}

function DemoFields({
  draft,
  update,
  errors,
}: {
  draft: DemoDraft;
  update: (patch: Partial<DemoDraft>) => void;
  errors: Partial<Record<DemoField, string>>;
}) {
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
        <Field label="What you'll demo" error={errors.name} required>
          {(props) => (
            <Input
              {...props}
              value={draft.name}
              onChange={(e) => update({ name: e.target.value })}
              placeholder="e.g. Pay with a saved card"
            />
          )}
        </Field>
        <Field label="Minutes" hint="Blank: not timed yet" error={errors.minutes}>
          {(props) => (
            <Input
              {...props}
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_DEMO_MINUTES}
              value={draft.minutes}
              onChange={(e) => update({ minutes: e.target.value })}
              className="font-data"
            />
          )}
        </Field>
      </div>
      <Field label="What was built" hint="Optional. One line for the audience.">
        {(props) => (
          <Input
            {...props}
            value={draft.description}
            onChange={(e) => update({ description: e.target.value })}
            placeholder="e.g. One tap on the payment step"
          />
        )}
      </Field>
      <Field label="Acceptance criteria" hint="Optional. What the demo shows is true.">
        {(props) => (
          <Textarea
            {...props}
            rows={2}
            value={draft.acceptanceCriteria}
            onChange={(e) => update({ acceptanceCriteria: e.target.value })}
            placeholder="Given… when… then…"
            className="resize-none"
          />
        )}
      </Field>
    </>
  );
}

/** "Add item": nothing joins the demo script until it has a name. */
export function DemoAddForm({ onAdd }: { onAdd: (values: DemoValues) => void }) {
  const form = useItemForm<DemoDraft, DemoValues, DemoField>({
    initial: EMPTY_DEMO_DRAFT,
    validate: validateDemo,
    onSave: onAdd,
  });
  return (
    <ItemForm
      form={form}
      submitLabel="Add item"
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
    >
      <DemoFields draft={form.draft} update={form.update} errors={form.errors} />
    </ItemForm>
  );
}

/** Edit a demo item in place. Enter saves, Escape cancels. */
export function DemoEditor({
  feature,
  onSave,
  onCancel,
}: {
  feature: DemoFeature;
  onSave: (values: DemoValues) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<DemoDraft, DemoValues, DemoField>({
    initial: () => demoDraftFrom(feature),
    validate: validateDemo,
    onSave,
    resetOnSave: false,
  });
  const { formRef } = form;
  // Open on the name, where the keyboard user was heading.
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("input")?.focus();
  }, [formRef]);
  return (
    <ItemForm form={form} submitLabel="Save" onCancel={onCancel}>
      <DemoFields draft={form.draft} update={form.update} errors={form.errors} />
    </ItemForm>
  );
}
