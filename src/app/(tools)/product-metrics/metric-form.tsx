"use client";

/**
 * The form for one product metric: what it is (name, meaning, unit, which
 * way is better, baseline, target, owner) and which views it sits in (the
 * North Star or an input, a HEART goal for a feature, a funnel stage).
 * `validateMetric` checks the values and `metricRuleProblems` the views'
 * rules, so the page refuses what Amr's verbs and the CRUD refuse.
 */

import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PersonPicker } from "@/components/team/person-picker";
import {
  AARRR_STAGES,
  HEART_CATEGORIES,
  type AarrrStage,
  type HeartCategory,
  type MetricDirection,
  type MetricRole,
  type ProductMetric,
} from "@/lib/stores/workspace-types";
import {
  AARRR_LABEL,
  DIRECTION_LABEL,
  HEART_LABEL,
  HEART_TEXT_MAX,
  METRIC_DEFINITION_MAX,
  METRIC_NAME_MAX,
  METRIC_UNIT_MAX,
  ROLE_LABEL,
  metricRuleErrors,
  validateMetric,
  type MetricDraft,
  type MetricField,
  type MetricValues,
} from "@/lib/product-metrics/model";
import type { Validation } from "@/lib/utils/form";

/** Matches <Input>: 44 px / 16 px on touch, 36 px / 14 px for a mouse at md+. */
export const SELECT_CLASS =
  "flex h-11 pointer-fine:md:h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-base pointer-fine:md:text-sm text-text shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/**
 * The form's check: `validateMetric`, then each view's rule against the
 * stored metrics (`all`), each on the field that sets it (the cap on the name).
 */
export function checkMetricDraft(
  d: MetricDraft,
  id: string,
  all: readonly ProductMetric[]
): Validation<MetricValues, MetricField> {
  const checked = validateMetric(d);
  if (!checked.ok) return checked;
  const v = checked.values;
  const rules = metricRuleErrors({ id, role: v.role, aarrr: v.aarrr, heart: v.heart }, all);
  const errors: Partial<Record<MetricField, string>> = {
    ...(rules.cap ? { name: rules.cap } : {}),
    ...(rules.role ? { role: rules.role } : {}),
    ...(rules.aarrr ? { aarrr: rules.aarrr } : {}),
    ...(rules.heart ? { heartCategory: rules.heart } : {}),
  };
  return Object.keys(errors).length > 0 ? { ok: false, errors } : checked;
}

/** What a render-prop child of the form can read and change. */
export interface MetricFormChild {
  draft: MetricDraft;
  update: (patch: Partial<MetricDraft>) => void;
}

export function MetricForm({
  initial,
  id,
  all,
  submitLabel,
  onSave,
  onCancel,
  views = true,
  directionLockedBy,
  children,
}: {
  initial: MetricDraft;
  /** The row's id (a new one's too), so the rules leave its own stored row out. */
  id: string;
  all: readonly ProductMetric[];
  submitLabel: string;
  onSave: (values: MetricValues) => void;
  onCancel: () => void;
  /** Show the North Star, HEART and funnel fields. */
  views?: boolean;
  /** The toolkit number that sets "Which way is better"; the field is then fixed. */
  directionLockedBy?: string;
  children?: React.ReactNode | ((form: MetricFormChild) => React.ReactNode);
}) {
  const form = useItemForm<MetricDraft, MetricValues, MetricField>({
    initial,
    validate: (d) => checkMetricDraft(d, id, all),
    onSave: (values) => onSave(values),
    resetOnSave: false,
  });
  const { draft, update, errors } = form;
  return (
    <ItemForm form={form} submitLabel={submitLabel} onCancel={onCancel}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Name" error={errors.name} required className="md:col-span-2">
          {(props) => (
            <Input
              {...props}
              maxLength={METRIC_NAME_MAX}
              value={draft.name}
              onChange={(e) => update({ name: e.target.value })}
              placeholder="Teams that hold a retro each week"
            />
          )}
        </Field>
        <Field
          label="What it means"
          hint="How it is counted, so everyone reads it the same way."
          error={errors.definition}
          className="md:col-span-2"
        >
          {(props) => (
            <Textarea
              {...props}
              rows={2}
              maxLength={METRIC_DEFINITION_MAX}
              value={draft.definition}
              onChange={(e) => update({ definition: e.target.value })}
            />
          )}
        </Field>
        <Field
          label="Which way is better"
          hint={directionLockedBy ? `Set by “${directionLockedBy}”.` : undefined}
          error={errors.direction}
        >
          {(props) => (
            <select
              {...props}
              className={SELECT_CLASS}
              disabled={Boolean(directionLockedBy)}
              value={draft.direction}
              onChange={(e) => update({ direction: e.target.value as MetricDirection })}
            >
              <option value="increase">{DIRECTION_LABEL.increase}</option>
              <option value="decrease">{DIRECTION_LABEL.decrease}</option>
            </select>
          )}
        </Field>
        <Field label="Unit" hint="Such as %, people or days." error={errors.unit}>
          {(props) => (
            <Input
              {...props}
              maxLength={METRIC_UNIT_MAX}
              value={draft.unit}
              onChange={(e) => update({ unit: e.target.value })}
            />
          )}
        </Field>
        <Field
          label="Baseline"
          hint="Where it stood when you started. Blank: the first reading."
          error={errors.baseline}
        >
          {(props) => (
            <Input
              {...props}
              inputMode="decimal"
              value={draft.baseline}
              onChange={(e) => update({ baseline: e.target.value })}
            />
          )}
        </Field>
        <Field label="Target" error={errors.target}>
          {(props) => (
            <Input
              {...props}
              inputMode="decimal"
              value={draft.target}
              onChange={(e) => update({ target: e.target.value })}
            />
          )}
        </Field>
        <PersonPicker
          label="Owner"
          value={draft.owner}
          onChange={(owner) => update({ owner })}
          error={errors.owner}
          className="md:col-span-2"
        />
      </div>
      {typeof children === "function" ? children({ draft, update }) : children}
      {views && (
        <fieldset className="min-w-0 space-y-3 rounded-md border border-border p-3">
          <legend className="px-1 text-sm text-text">Where it shows (optional)</legend>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="North Star" error={errors.role}>
              {(props) => (
                <select
                  {...props}
                  className={SELECT_CLASS}
                  value={draft.role}
                  onChange={(e) => update({ role: e.target.value as MetricRole | "" })}
                >
                  <option value="">Not part of it</option>
                  <option value="north-star">{ROLE_LABEL["north-star"]}</option>
                  <option value="input">{ROLE_LABEL.input} to the North Star</option>
                </select>
              )}
            </Field>
            <Field label="Funnel stage" error={errors.aarrr}>
              {(props) => (
                <select
                  {...props}
                  className={SELECT_CLASS}
                  value={draft.aarrr}
                  onChange={(e) => update({ aarrr: e.target.value as AarrrStage | "" })}
                >
                  <option value="">No stage</option>
                  {AARRR_STAGES.map((s) => (
                    <option key={s} value={s}>
                      {AARRR_LABEL[s]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="HEART category" error={errors.heartCategory}>
              {(props) => (
                <select
                  {...props}
                  className={SELECT_CLASS}
                  value={draft.heartCategory}
                  onChange={(e) => update({ heartCategory: e.target.value as HeartCategory | "" })}
                >
                  <option value="">No HEART goal</option>
                  {HEART_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {HEART_LABEL[c]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {draft.heartCategory && (
              <>
                <Field label="Feature" error={errors.heartFeature} required>
                  {(props) => (
                    <Input
                      {...props}
                      maxLength={HEART_TEXT_MAX}
                      value={draft.heartFeature}
                      onChange={(e) => update({ heartFeature: e.target.value })}
                    />
                  )}
                </Field>
                <Field label="Goal" error={errors.heartGoal}>
                  {(props) => (
                    <Input
                      {...props}
                      maxLength={HEART_TEXT_MAX}
                      value={draft.heartGoal}
                      onChange={(e) => update({ heartGoal: e.target.value })}
                    />
                  )}
                </Field>
                <Field
                  label="Signal"
                  hint="What people do that shows it."
                  error={errors.heartSignal}
                >
                  {(props) => (
                    <Input
                      {...props}
                      maxLength={HEART_TEXT_MAX}
                      value={draft.heartSignal}
                      onChange={(e) => update({ heartSignal: e.target.value })}
                    />
                  )}
                </Field>
              </>
            )}
          </div>
        </fieldset>
      )}
    </ItemForm>
  );
}
