"use client";

/**
 * Adding a part to a strategy map, or editing one, with the fields its
 * level shows (lib/strategy-map/formats): its text, a detail, a measure,
 * an owner (from the team, or typed) and, on a strategy tree, its status
 * with a note when it has questions. Nothing is saved until the `validate`
 * the page gives passes; Enter saves, Escape cancels, and the first field
 * takes focus. A tool adds its own fields (Impact Map's persona) through
 * `extraFields`.
 */

import { useEffect, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { ItemForm, useItemForm, type ItemFormState } from "@/components/shared/item-form";
import { PersonPicker } from "@/components/team/person-picker";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup } from "@/components/ui/toggle-group";
import type { StrategyMapFormat, StrategyNodeStatus } from "@/lib/stores/workspace-types";
import type { Validation } from "@/lib/utils/form";
import { STATUS_LABEL, levelHas, levelOf } from "@/lib/strategy-map/formats";
import {
  NODE_DETAIL_MAX,
  NODE_FIELD_MAX,
  NODE_TEXT_MAX,
  type NodeDraft,
  type NodeField,
  type NodeValues,
} from "@/lib/strategy-map/model";

export type NodeFormState = ItemFormState<NodeDraft, NodeField>;

const STATUS_OPTIONS = (Object.keys(STATUS_LABEL) as StrategyNodeStatus[]).map((value) => ({
  value,
  label: STATUS_LABEL[value],
}));

export interface NodeFormProps {
  format: StrategyMapFormat;
  level: number;
  initial: NodeDraft | (() => NodeDraft);
  validate: (draft: NodeDraft) => Validation<NodeValues, NodeField>;
  onSave: (values: NodeValues) => void;
  onCancel: () => void;
  /** Names the action: "Add actor", "Save". */
  submitLabel: string;
  /** The group's name for assistive tech: "New actor under “Grow repeat orders”". */
  label: string;
  /** Start again after a save (an add form), or keep the values (an edit). */
  resetOnSave?: boolean;
  /** A tool's own fields, after the text (Impact Map's persona). */
  extraFields?: (form: NodeFormState) => ReactNode;
}

function NodeFields({
  form,
  format,
  level,
  extraFields,
}: {
  form: NodeFormState;
  format: StrategyMapFormat;
  level: number;
  extraFields?: (form: NodeFormState) => ReactNode;
}) {
  const { draft, update, errors } = form;
  const lvl = levelOf(format, level);
  const asks = (f: "measure" | "owner") =>
    lvl.required.includes(f)
      ? `This level asks for ${f === "measure" ? "a measure" : "an owner"}.`
      : "Optional.";
  return (
    <>
      <Field label={lvl.label} hint={lvl.hint} error={errors.text} required>
        {(props) => (
          <Input
            {...props}
            maxLength={NODE_TEXT_MAX}
            value={draft.text}
            onChange={(e) => update({ text: e.target.value })}
          />
        )}
      </Field>
      {extraFields?.(form)}
      {(levelHas(format, level, "measure") || levelHas(format, level, "owner")) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {levelHas(format, level, "measure") && (
            <Field label="Measure" hint={asks("measure")} error={errors.measure}>
              {(props) => (
                <Input
                  {...props}
                  maxLength={NODE_FIELD_MAX}
                  value={draft.measure}
                  onChange={(e) => update({ measure: e.target.value })}
                />
              )}
            </Field>
          )}
          {levelHas(format, level, "owner") && (
            <PersonPicker
              label="Owner"
              hint={asks("owner")}
              error={errors.owner}
              value={draft.owner}
              onChange={(owner) => update({ owner: owner.slice(0, NODE_FIELD_MAX) })}
            />
          )}
        </div>
      )}
      <Field label="Detail" hint="Optional." error={errors.detail}>
        {(props) => (
          <Textarea
            {...props}
            rows={2}
            maxLength={NODE_DETAIL_MAX}
            value={draft.detail}
            onChange={(e) => update({ detail: e.target.value })}
          />
        )}
      </Field>
      {levelHas(format, level, "status") && (
        <div className="space-y-1.5">
          <p className="text-sm text-text" aria-hidden="true">
            Status
          </p>
          <ToggleGroup
            label="Status"
            size="sm"
            options={STATUS_OPTIONS}
            value={draft.status || "proposed"}
            onValueChange={(status) => update({ status })}
          />
        </div>
      )}
      {levelHas(format, level, "status") && (draft.status === "questioned" || draft.note) && (
        <Field
          label={draft.status === "questioned" ? "The question" : "Note"}
          hint="What needs an answer before it's agreed."
          error={errors.note}
        >
          {(props) => (
            <Textarea
              {...props}
              rows={2}
              maxLength={NODE_DETAIL_MAX}
              value={draft.note}
              onChange={(e) => update({ note: e.target.value })}
            />
          )}
        </Field>
      )}
    </>
  );
}

/** The form for one part: an add under a parent, or an edit in place. */
export function NodeForm({
  format,
  level,
  initial,
  validate,
  onSave,
  onCancel,
  submitLabel,
  label,
  resetOnSave = false,
  extraFields,
}: NodeFormProps) {
  const form = useItemForm<NodeDraft, NodeValues, NodeField>({
    initial,
    validate,
    onSave,
    resetOnSave,
  });
  const { formRef } = form;
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("input, textarea")?.focus();
  }, [formRef]);
  return (
    <div role="group" aria-label={label} className="rounded-lg border border-accent/40 bg-card p-3">
      <ItemForm
        form={form}
        submitLabel={submitLabel}
        submitIcon={
          submitLabel.startsWith("Add") ? (
            <Plus className="h-4 w-4" aria-hidden="true" />
          ) : undefined
        }
        onCancel={onCancel}
      >
        <NodeFields form={form} format={format} level={level} extraFields={extraFields} />
      </ItemForm>
    </div>
  );
}
