"use client";

/**
 * Plan: the current rate, the smallest change worth finding (a share of
 * the rate or points), confidence, power, one- or two-sided, and visitors
 * a day. The answer updates as you type: people each version needs, the
 * total, the days and whole weeks it runs, and the smallest effect the
 * traffic could find in 1 to 4 weeks. lib/experiments' validatePlan checks
 * the fields, for the page and the agent alike; a blank field waits
 * quietly until "Save" asks for it.
 */

import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { liftText, percentText, pointsText, rateText } from "@/lib/experiments/ab";
import {
  PLAN_CONFIDENCES,
  PLAN_POWERS,
  countText,
  effectTable,
  planResult,
  validatePlan,
  type PlanDraft,
  type PlanField,
} from "@/lib/experiments/model";
import type { FormErrors } from "@/lib/utils/form";

export function ToggleField<T extends string | number>({
  label,
  groupLabel,
  options,
  value,
  onChange,
}: {
  label: string;
  /** The group's accessible name when the visible label needs more context ("Status of …"). */
  groupLabel?: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-sm text-text" aria-hidden="true">
        {label}
      </span>
      <ToggleGroup
        label={groupLabel ?? label}
        size="sm"
        options={options}
        value={value}
        onValueChange={onChange}
      />
    </div>
  );
}

/** Which errors show: a typed field's at once, every field's once Save was tried. */
export function shownErrors<K extends string>(
  errors: FormErrors<K>,
  draft: Record<K, unknown>,
  all: boolean
): FormErrors<K> {
  if (all) return errors;
  const out: FormErrors<K> = {};
  for (const [k, v] of Object.entries(errors) as [K, string | undefined][]) {
    const typed = draft[k];
    if (typeof typed !== "string" || typed.trim() !== "") out[k] = v;
  }
  return out;
}

export function PlanFields({
  draft,
  onChange,
  showAll,
}: {
  draft: PlanDraft;
  onChange: (patch: Partial<PlanDraft>) => void;
  /** Save was tried: blank fields say what they need too. */
  showAll: boolean;
}) {
  const checked = validatePlan(draft);
  const errors = shownErrors<PlanField>(
    checked.ok ? {} : checked.errors,
    draft as unknown as Record<PlanField, unknown>,
    showAll
  );
  const plan = checked.ok ? checked.values : null;
  const sized = plan ? planResult(plan) : null;
  const effects = plan ? effectTable(plan) : [];
  const relative = draft.mdeMode === "relative";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          label="Current conversion rate (%)"
          hint="Of the people who see the step today, the share who convert."
          error={errors.baselinePct}
          required
        >
          {(props) => (
            <Input
              {...props}
              inputMode="decimal"
              value={draft.baselinePct}
              placeholder="e.g. 10"
              onChange={(e) => onChange({ baselinePct: e.target.value })}
            />
          )}
        </Field>
        <Field
          label={
            relative
              ? "Smallest change worth finding (%)"
              : "Smallest change worth finding (points)"
          }
          hint={
            relative
              ? "As a share of the current rate: 20 finds 10% → 12%."
              : "In percentage points: 2 finds 10% → 12%."
          }
          error={errors.mde}
          required
        >
          {(props) => (
            <Input
              {...props}
              inputMode="decimal"
              value={draft.mde}
              placeholder={relative ? "e.g. 20" : "e.g. 2"}
              onChange={(e) => onChange({ mde: e.target.value })}
            />
          )}
        </Field>
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-3">
        <ToggleField
          label="Count the change as"
          value={draft.mdeMode}
          onChange={(mdeMode) => onChange({ mdeMode })}
          options={[
            { value: "relative", label: "% of the rate" },
            { value: "absolute", label: "Points" },
          ]}
        />
        <ToggleField
          label="Confidence"
          value={draft.confidence}
          onChange={(confidence) => onChange({ confidence })}
          options={PLAN_CONFIDENCES.map((c) => ({ value: c, label: percentText(c) }))}
        />
        <ToggleField
          label="Power"
          value={draft.power}
          onChange={(power) => onChange({ power })}
          options={PLAN_POWERS.map((p) => ({ value: p, label: percentText(p) }))}
        />
        <ToggleField
          label="Sides"
          value={draft.sided}
          onChange={(sided) => onChange({ sided })}
          options={[
            { value: "two", label: "Two-sided" },
            { value: "one", label: "One-sided" },
          ]}
        />
      </div>
      <Field
        label="Visitors a day (optional)"
        hint="Both versions together: it says how long the test runs."
        error={errors.dailyTraffic}
        className="max-w-xs"
      >
        {(props) => (
          <Input
            {...props}
            inputMode="numeric"
            value={draft.dailyTraffic}
            placeholder="e.g. 800"
            onChange={(e) => onChange({ dailyTraffic: e.target.value })}
          />
        )}
      </Field>

      <div className="rounded-md border border-border bg-surface-deep p-3" role="status">
        {!plan || !sized ? (
          <p className="text-sm text-sub">
            Enter the current rate and the smallest change worth finding to see how many people each
            version needs.
          </p>
        ) : sized.tooBig ? (
          <p className="text-sm text-warning">
            Pick a bigger effect: this needs over 100 million people a version.
          </p>
        ) : (
          <div className="space-y-1 text-sm">
            <p className="font-medium text-text">
              {countText(sized.perVariant)} people a version, {countText(sized.total)} in all
            </p>
            <p className="text-sub">
              From {rateText(plan.baseline)} to {rateText(sized.treatment)}
              {sized.run
                ? `: ${sized.run.days} ${sized.run.days === 1 ? "day" : "days"} at ${countText(plan.dailyTraffic ?? 0)} a day, so run ${sized.run.weeks} whole ${sized.run.weeks === 1 ? "week" : "weeks"}.`
                : ". Add visitors a day to see how long that takes."}
            </p>
          </div>
        )}
      </div>

      {effects.length > 0 && (
        <table className="w-full text-sm">
          <caption className="pb-1 text-left text-xs text-sub">
            The smallest effect you could find
          </caption>
          <thead>
            <tr className="border-b border-border text-left text-xs text-sub">
              <th scope="col" className="py-1 pr-3 font-medium">
                Run for
              </th>
              <th scope="col" className="py-1 pr-3 text-right font-medium">
                A version
              </th>
              <th scope="col" className="py-1 font-medium">
                Smallest effect
              </th>
            </tr>
          </thead>
          <tbody>
            {effects.map((e) => (
              <tr key={e.weeks} className="border-b border-border">
                <th scope="row" className="py-1 pr-3 text-left font-normal text-text">
                  {e.weeks} {e.weeks === 1 ? "week" : "weeks"}
                </th>
                <td className="py-1 pr-3 text-right tabular-nums">{countText(e.perVariant)}</td>
                <td className="py-1 tabular-nums">
                  {e.absolute === null || e.relative === null
                    ? "Not enough people"
                    : `${pointsText(e.absolute)} points (${liftText(e.relative)})`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
