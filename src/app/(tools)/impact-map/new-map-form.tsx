"use client";

/**
 * A new impact map: its goal (the change the business wants), a measure
 * and a due day, typed or started from the active Product Goal, which the
 * map then links to. Nothing is saved without the goal.
 */

import { useEffect } from "react";
import { Goal, Plus } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { ProductGoal } from "@/lib/stores/workspace-types";
import { NODE_FIELD_MAX, NODE_TEXT_MAX, cleanText } from "@/lib/strategy-map/model";
import {
  emptyNewMap,
  validateNewMap,
  type NewMapDraft,
  type NewMapField,
  type NewMapValues,
} from "./form";

export function NewMapForm({
  activeGoal,
  onCreate,
  onCancel,
}: {
  /** The active Product Goal, to start from; undefined when there is none. */
  activeGoal: ProductGoal | undefined;
  onCreate: (values: NewMapValues) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<NewMapDraft, NewMapValues, NewMapField>({
    initial: emptyNewMap,
    validate: validateNewMap,
    onSave: onCreate,
  });
  const { draft, update, errors, formRef } = form;
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("input")?.focus();
  }, [formRef]);

  const fromGoal = () => {
    if (!activeGoal) return;
    update({
      goal: cleanText(activeGoal.statement, NODE_TEXT_MAX),
      measure: cleanText(activeGoal.measures[0], NODE_FIELD_MAX),
      targetDate: activeGoal.targetDate ?? "",
      productGoalId: activeGoal.id,
    });
  };

  return (
    <div
      role="group"
      aria-label="New impact map"
      className="rounded-lg border border-accent/40 bg-card p-3"
    >
      <ItemForm
        form={form}
        submitLabel="Start the map"
        submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
        onCancel={onCancel}
        footer={
          activeGoal ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={fromGoal}
            >
              <Goal className="h-4 w-4" aria-hidden="true" />
              Start from the Product Goal
            </Button>
          ) : null
        }
      >
        <Field
          label="Goal"
          hint="The change the business wants, with a measure and a date."
          error={errors.goal}
          required
        >
          {(props) => (
            <Input
              {...props}
              maxLength={NODE_TEXT_MAX}
              value={draft.goal}
              onChange={(e) => update({ goal: e.target.value })}
            />
          )}
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Measure" hint="Optional. How you'll know it moved." error={errors.measure}>
            {(props) => (
              <Input
                {...props}
                maxLength={NODE_FIELD_MAX}
                value={draft.measure}
                onChange={(e) => update({ measure: e.target.value })}
              />
            )}
          </Field>
          <Field label="Due" hint="Optional." error={errors.targetDate}>
            {(props) => (
              <Input
                {...props}
                type="date"
                value={draft.targetDate}
                onChange={(e) => update({ targetDate: e.target.value })}
              />
            )}
          </Field>
        </div>
        {draft.productGoalId && (
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-sub" role="status">
            <span>Linked to the Product Goal.</span>
            <button
              type="button"
              className="min-touch-coarse rounded text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              onClick={() => update({ productGoalId: "" })}
            >
              Unlink
            </button>
          </p>
        )}
      </ItemForm>
    </div>
  );
}
