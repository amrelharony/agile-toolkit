"use client";

import { useEffect, useId, useRef } from "react";
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
  label,
  value,
  onChange,
  error,
}: {
  /** The radio group's name: "Layer", or "Layer of step 3" in a row editor. */
  label: string;
  value: Layer | null;
  onChange: (layer: Layer) => void;
  error?: string;
}) {
  const errorId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  // Mark the group required and link its message, as Field does for the
  // Step input. ToggleGroup takes no ARIA props, so set them on its radio
  // group here; React leaves attributes it doesn't render alone. Not
  // aria-invalid: focusFirstInvalid would then pick the group itself, which
  // can't take focus, instead of its radio.
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
        Layer
        <span className="ml-0.5 text-danger">*</span>
      </span>
      <ToggleGroup
        label={label}
        options={LAYERS.map((l) => ({ value: l.id, label: l.label, description: l.meaning }))}
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

function StepFields({
  draft,
  update,
  errors,
  position,
}: {
  draft: StepDraft;
  update: (patch: Partial<StepDraft>) => void;
  errors: Partial<Record<StepField, string>>;
  /**
   * The step's place on the path, in a row editor. The add form stays on
   * screen meanwhile, so its fields are named apart: "Step 3" and "Layer
   * of step 3" next to "Step" and "Layer".
   */
  position?: number;
}) {
  return (
    <>
      <Field label={position ? `Step ${position}` : "Step"} error={errors.text} required>
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
        label={position ? `Layer of step ${position}` : "Layer"}
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
  position,
  onSave,
  onCancel,
}: {
  step: SkeletonStep;
  /** Its place on the path, from 1: names the fields apart from the add form's. */
  position: number;
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
      <StepFields
        draft={form.draft}
        update={form.update}
        errors={form.errors}
        position={position}
      />
    </ItemForm>
  );
}
