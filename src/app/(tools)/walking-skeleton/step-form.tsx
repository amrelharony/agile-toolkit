"use client";

import { useEffect } from "react";
import { Plus } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { STORY_TITLE_MAX } from "@/lib/handoffs/targets/backlog-story";
import type { Validation } from "@/lib/utils/form";
import { LAYERS, isLayer } from "./skeleton";
import type { Layer, SkeletonStep } from "./store";

export interface StepDraft {
  text: string;
  /** Unset until picked: a step never lands in "UI" because it was first in the list. */
  layer: Layer | null;
}

export type StepField = keyof StepDraft;
export interface StepValues {
  text: string;
  layer: Layer;
}

export const EMPTY_STEP: StepDraft = { text: "", layer: null };

export function validateStep(d: StepDraft): Validation<StepValues, StepField> {
  const errors: Partial<Record<StepField, string>> = {};
  const text = d.text.trim();
  if (!text) errors.text = "Describe the step.";
  // Steps can become backlog stories, so they share the story title cap.
  else if (text.length > STORY_TITLE_MAX)
    errors.text = `Keep it to ${STORY_TITLE_MAX} characters or fewer.`;
  if (!isLayer(d.layer)) errors.layer = "Pick the layer this step touches.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, values: { text, layer: d.layer as Layer } };
}

/**
 * The four layers as a radio group. The wrapper carries
 * `data-scale-invalid`, so a failed save focuses it like a ScalePicker.
 */
function LayerPicker({
  value,
  onChange,
  error,
}: {
  value: Layer | null;
  onChange: (layer: Layer) => void;
  error?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-scale-invalid={error ? "true" : undefined}>
      {/* The radio group carries the same name; this is the visible label. */}
      <span className="text-sm text-text" aria-hidden="true">
        Layer
      </span>
      <ToggleGroup
        label="Layer"
        options={LAYERS.map((l) => ({ value: l.id, label: l.label, description: l.meaning }))}
        value={value}
        onValueChange={onChange}
      />
      {error && (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function StepFields({
  draft,
  update,
  errors,
}: {
  draft: StepDraft;
  update: (patch: Partial<StepDraft>) => void;
  errors: Partial<Record<StepField, string>>;
}) {
  return (
    <>
      <Field label="Step" error={errors.text} required>
        {(props) => (
          <Input
            {...props}
            value={draft.text}
            onChange={(e) => update({ text: e.target.value })}
            placeholder="e.g. POST /orders saves the order"
          />
        )}
      </Field>
      <LayerPicker
        value={draft.layer}
        onChange={(layer) => update({ layer })}
        error={errors.layer}
      />
    </>
  );
}

/** "Add step": type it, pick its layer, press Enter. Nothing is saved until both are set. */
export function StepAddForm({ onAdd }: { onAdd: (values: StepValues) => void }) {
  const form = useItemForm<StepDraft, StepValues, StepField>({
    initial: EMPTY_STEP,
    validate: validateStep,
    onSave: onAdd,
  });
  return (
    <ItemForm
      form={form}
      submitLabel="Add step"
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
    >
      <StepFields draft={form.draft} update={form.update} errors={form.errors} />
    </ItemForm>
  );
}

/** Edit a step where it sits on the path. Enter saves, Escape cancels. */
export function StepRowEditor({
  step,
  onSave,
  onCancel,
}: {
  step: SkeletonStep;
  onSave: (values: StepValues) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<StepDraft, StepValues, StepField>({
    initial: { text: step.text, layer: isLayer(step.layer) ? step.layer : null },
    validate: validateStep,
    onSave,
    resetOnSave: false,
  });
  const { formRef } = form;
  // Open on the text, so the keyboard user lands where they were heading.
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("input")?.focus();
  }, [formRef]);
  return (
    <ItemForm form={form} submitLabel="Save" onCancel={onCancel}>
      <StepFields draft={form.draft} update={form.update} errors={form.errors} />
    </ItemForm>
  );
}
