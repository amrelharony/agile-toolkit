"use client";

import { Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import {
  EMPTY_STAGE,
  STAGE_DESCRIPTION_MAX,
  STAGE_NAME_MAX,
  validateStage,
  type StageValues,
} from "./form";

/**
 * Draft-then-save for a new stage at the end of the map shown. Every
 * number is typed (no 1 / 2 / 90 defaults), and a process time longer
 * than the lead time is an error, not a warning.
 */
export function AddStageForm({
  mapLabel,
  onAdd,
}: {
  /** "current state" or "future state": where the stage goes. */
  mapLabel: string;
  onAdd: (values: StageValues) => void;
}) {
  const form = useItemForm({ initial: EMPTY_STAGE, validate: validateStage, onSave: onAdd });
  const { draft, update, errors } = form;
  return (
    <ItemForm form={form} submitLabel="Add stage" submitIcon={<Plus aria-hidden="true" />}>
      <p className="text-xs text-sub">Adds a stage at the end of the {mapLabel} map.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Stage name" required error={errors.name}>
          {(p) => (
            <Input
              {...p}
              value={draft.name}
              maxLength={STAGE_NAME_MAX}
              placeholder="e.g. Code review"
              onChange={(e) => update({ name: e.target.value })}
            />
          )}
        </Field>
        <Field label="Description" hint="Optional: what happens here, who does it.">
          {(p) => (
            <Textarea
              {...p}
              rows={1}
              value={draft.description}
              maxLength={STAGE_DESCRIPTION_MAX}
              className="resize-none"
              onChange={(e) => update({ description: e.target.value })}
            />
          )}
        </Field>
        <Field
          label="Process time (days)"
          required
          hint="Time someone is actually working on it."
          error={errors.processTime}
        >
          {(p) => (
            <Input
              {...p}
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={draft.processTime}
              onChange={(e) => update({ processTime: e.target.value })}
            />
          )}
        </Field>
        <Field
          label="Lead time (days)"
          required
          hint="From arriving in the stage to leaving it, waiting included."
          error={errors.leadTime}
        >
          {(p) => (
            <Input
              {...p}
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={draft.leadTime}
              onChange={(e) => update({ leadTime: e.target.value })}
            />
          )}
        </Field>
        <Field
          label="%C/A"
          required
          hint="Percent complete and accurate: work the next stage can use without rework."
          error={errors.completeAccurate}
        >
          {(p) => (
            <Input
              {...p}
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              value={draft.completeAccurate}
              onChange={(e) => update({ completeAccurate: e.target.value })}
            />
          )}
        </Field>
      </div>
    </ItemForm>
  );
}
