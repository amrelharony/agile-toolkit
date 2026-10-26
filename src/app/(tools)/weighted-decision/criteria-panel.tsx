"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { BlurInput } from "@/components/shared/blur-fields";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import type { WeightedCriterion } from "@/lib/stores/workspace-types";
import type { FormErrors, Validation } from "@/lib/utils/form";
import {
  CRITERION_NAME_MAX,
  MEANING_MAX,
  weightError,
  type CriterionShare,
} from "@/lib/weighted/model";

export interface CriterionDraft {
  name: string;
  /** As typed: a cleared weight is an error, never a silent 1. */
  weight: string;
  low: string;
  high: string;
}

export interface NewCriterion {
  name: string;
  weight: number;
  low?: string;
  high?: string;
}

/**
 * A criterion needs a name (not one the matrix already has) and a weight
 * of 0 or more: weights are relative, 2 counts twice as much as 1, and 0
 * keeps a criterion on the matrix without counting it.
 */
export function validateCriterion(
  d: CriterionDraft,
  taken: readonly string[]
): Validation<NewCriterion, keyof CriterionDraft> {
  const errors: FormErrors<keyof CriterionDraft> = {};
  const name = d.name.trim();
  if (!name) errors.name = "Name the criterion.";
  else if (name.length > CRITERION_NAME_MAX) {
    errors.name = `Keep the name to ${CRITERION_NAME_MAX} characters.`;
  } else if (taken.some((t) => t.trim().toLowerCase() === name.toLowerCase())) {
    errors.name = "This matrix already has a criterion with that name.";
  }
  const w = weightError(d.weight);
  if (w) errors.weight = w;
  if (d.low.trim().length > MEANING_MAX) errors.low = `Keep it to ${MEANING_MAX} characters.`;
  if (d.high.trim().length > MEANING_MAX) errors.high = `Keep it to ${MEANING_MAX} characters.`;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const low = d.low.trim();
  const high = d.high.trim();
  return {
    ok: true,
    values: { name, weight: Number(d.weight), ...(low ? { low } : {}), ...(high ? { high } : {}) },
  };
}

const EMPTY: CriterionDraft = { name: "", weight: "", low: "", high: "" };

/** One criterion's weight, edited in place; an invalid one isn't saved and says why. */
function WeightInPlace({
  criterion,
  onSave,
}: {
  criterion: WeightedCriterion;
  onSave: (weight: number) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <Field
      label={`Weight of ${criterion.name}`}
      hideLabel
      error={error ?? undefined}
      className="w-24 gap-1"
    >
      {(props) => (
        <BlurInput
          id={props.id}
          aria-label={`Weight of ${criterion.name}`}
          value={String(criterion.weight)}
          className="h-9"
          onCommit={(next) => {
            const why = weightError(next);
            setError(why);
            if (!why && Number(next) !== criterion.weight) onSave(Number(next));
          }}
        />
      )}
    </Field>
  );
}

/**
 * The matrix's criteria: add one (name and weight required), rename it,
 * change its weight and what a 1 and a 10 mean, all in place, or delete it
 * (with Undo, which puts its scores back too). Each shows its share of the
 * weight that counts.
 */
export function CriteriaPanel({
  criteria,
  shares,
  weightSum,
  onAdd,
  onPatch,
  onDelete,
}: {
  criteria: readonly WeightedCriterion[];
  shares: readonly CriterionShare[];
  weightSum: number;
  onAdd: (values: NewCriterion) => void;
  onPatch: (c: WeightedCriterion, patch: Partial<WeightedCriterion>, what: string) => void;
  onDelete: (c: WeightedCriterion) => void;
}) {
  const form = useItemForm<CriterionDraft, NewCriterion, keyof CriterionDraft>({
    initial: EMPTY,
    validate: (d) =>
      validateCriterion(
        d,
        criteria.map((c) => c.name)
      ),
    onSave: onAdd,
  });
  const { draft, update, errors } = form;
  const shareOf = (id: string) => shares.find((s) => s.id === id);

  return (
    <div className="space-y-4">
      <ItemForm
        form={form}
        submitLabel="Add criterion"
        submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
      >
        <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_7rem]">
          <Field label="Criterion name" required error={errors.name}>
            {(props) => (
              <Input
                {...props}
                value={draft.name}
                maxLength={CRITERION_NAME_MAX}
                placeholder="e.g. Cost"
                onChange={(e) => update({ name: e.target.value })}
              />
            )}
          </Field>
          <Field label="Criterion weight" required error={errors.weight}>
            {(props) => (
              <Input
                {...props}
                inputMode="decimal"
                value={draft.weight}
                placeholder="e.g. 3"
                onChange={(e) => update({ weight: e.target.value })}
              />
            )}
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="A score of 1 means" error={errors.low}>
            {(props) => (
              <Input
                {...props}
                value={draft.low}
                maxLength={MEANING_MAX}
                placeholder="e.g. Over budget"
                onChange={(e) => update({ low: e.target.value })}
              />
            )}
          </Field>
          <Field label="A score of 10 means" error={errors.high}>
            {(props) => (
              <Input
                {...props}
                value={draft.high}
                maxLength={MEANING_MAX}
                placeholder="e.g. Well under budget"
                onChange={(e) => update({ high: e.target.value })}
              />
            )}
          </Field>
        </div>
      </ItemForm>

      {criteria.length > 0 && (
        <>
          <p className="text-xs text-sub">
            Weights are relative: a weight of 2 counts twice as much as a weight of 1, and 0 keeps a
            criterion without counting it.
          </p>
          {weightSum <= 0 && (
            <div
              role="alert"
              className="rounded border border-warning/30 bg-warning/5 px-2 py-1 text-xs text-warning"
            >
              Every weight is 0, so no option can have a total. Give at least one criterion a weight
              above 0.
            </div>
          )}
          <ul className="space-y-2">
            {criteria.map((c) => {
              const share = shareOf(c.id);
              return (
                <li
                  key={c.id}
                  className="flex flex-wrap items-start gap-2 rounded-md border border-border bg-surface-deep p-2"
                >
                  <BlurInput
                    aria-label={`Name of the criterion ${c.name}`}
                    value={c.name}
                    maxLength={CRITERION_NAME_MAX}
                    className="h-9 min-w-0 flex-1 basis-40"
                    onCommit={(next) => {
                      const name = next.trim();
                      if (name && name !== c.name) onPatch(c, { name }, "Renamed a criterion");
                    }}
                  />
                  <WeightInPlace
                    criterion={c}
                    onSave={(weight) => onPatch(c, { weight }, `Weighted ${c.name} ${weight}`)}
                  />
                  <span className="flex h-9 items-center font-mono text-xs text-sub">
                    {share?.active ? `${Math.round(share.share * 100)}%` : "not counted"}
                  </span>
                  <IconButton
                    label={`Delete the criterion ${c.name}`}
                    icon={<Trash2 className="h-4 w-4" />}
                    className="text-sub hover:text-danger"
                    onClick={() => onDelete(c)}
                  />
                  <div className="grid w-full gap-2 sm:grid-cols-2">
                    <BlurInput
                      aria-label={`What a score of 1 means on ${c.name}`}
                      value={c.low ?? ""}
                      maxLength={MEANING_MAX}
                      placeholder="1 means…"
                      className="h-8 text-xs"
                      onCommit={(next) =>
                        onPatch(c, { low: next.trim() || undefined }, "Changed what 1 means")
                      }
                    />
                    <BlurInput
                      aria-label={`What a score of 10 means on ${c.name}`}
                      value={c.high ?? ""}
                      maxLength={MEANING_MAX}
                      placeholder="10 means…"
                      className="h-8 text-xs"
                      onCommit={(next) =>
                        onPatch(c, { high: next.trim() || undefined }, "Changed what 10 means")
                      }
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
