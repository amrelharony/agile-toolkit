"use client";

/**
 * A new strategy tree: its shape (DIBB, Lean Value Tree or Hoshin Kanri,
 * each with a line on what it is for) and its root, named for the shape.
 * Nothing is saved until both are there.
 */

import { Plus } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup } from "@/components/ui/toggle-group";
import {
  STRATEGY_FORMATS,
  TREE_FORMATS,
  levelOf,
  type TreeFormat,
} from "@/lib/strategy-map/formats";
import { NODE_TEXT_MAX } from "@/lib/strategy-map/model";
import {
  emptyNewTree,
  validateNewTree,
  type NewTreeDraft,
  type NewTreeField,
  type NewTreeValues,
} from "./form";

export function NewTreeForm({
  onCreate,
  onCancel,
}: {
  onCreate: (values: NewTreeValues) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<NewTreeDraft, NewTreeValues, NewTreeField>({
    initial: emptyNewTree,
    validate: validateNewTree,
    onSave: onCreate,
  });
  const { draft, update, errors } = form;
  const format = draft.format || null;
  const root = format ? levelOf(format, 0) : null;
  return (
    <div
      role="group"
      aria-label="New strategy tree"
      className="rounded-lg border border-accent/40 bg-card p-3"
    >
      <ItemForm
        form={form}
        submitLabel="Start the tree"
        submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
        onCancel={onCancel}
      >
        <div className="space-y-1.5">
          <p className="text-sm text-text" aria-hidden="true">
            Shape
          </p>
          <ToggleGroup<TreeFormat>
            label="Shape"
            options={TREE_FORMATS.map((f) => ({
              value: f,
              label: STRATEGY_FORMATS[f].label,
              description: STRATEGY_FORMATS[f].blurb,
            }))}
            value={format}
            onValueChange={(f) => update({ format: f })}
            aria-describedby={errors.format ? "new-tree-format-error" : undefined}
          />
          {format && <p className="text-xs text-sub">{STRATEGY_FORMATS[format].blurb}</p>}
          {errors.format && (
            <p id="new-tree-format-error" role="alert" className="text-xs text-danger">
              {errors.format}
            </p>
          )}
        </div>
        <Field
          label={root ? root.label : "Root"}
          hint={root ? root.hint : "Pick a shape first: it says what the root is."}
          error={errors.root}
          required
        >
          {(props) => (
            <Input
              {...props}
              maxLength={NODE_TEXT_MAX}
              value={draft.root}
              onChange={(e) => update({ root: e.target.value })}
            />
          )}
        </Field>
      </ItemForm>
    </div>
  );
}
