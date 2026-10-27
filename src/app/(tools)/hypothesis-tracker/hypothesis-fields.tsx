"use client";

/**
 * The fields of a hypothesis, shared by the "New hypothesis" form and the
 * editor: the four lines a test is described by, an optional numeric
 * target (rise to at least, or fall to at most, a value, from a baseline),
 * the experiment and context, the status with its days (both backdatable),
 * the measured result and what was learned. lib/hypotheses'
 * validateHypothesis checks them, for the page and the agent alike.
 */

import type { ItemFormState } from "@/components/shared/item-form";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Hypothesis, MetricDirection } from "@/lib/stores/workspace-types";
import {
  HYPOTHESIS_STATUSES,
  HYPOTHESIS_TEXT_MAX,
  HYPOTHESIS_UNIT_MAX,
  isResolved,
  type HypothesisDraft,
  type HypothesisField,
} from "@/lib/hypotheses/model";
import { isBlank } from "@/lib/utils/form";
import { STATUS_LABEL } from "./view";

/** Matches <Input>: 44 px on phones, 36 px from md. */
export const SELECT_CLASS =
  "flex h-11 md:h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-base md:text-sm text-text shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export type HypothesisFormState = ItemFormState<HypothesisDraft, HypothesisField>;

const DIRECTION_LABEL: Record<MetricDirection, string> = {
  increase: "Rise to at least",
  decrease: "Fall to at most",
};

/** Room for a value the stored row already holds past the cap (kept until edited). */
const capFor = (stored: string | undefined) => Math.max(HYPOTHESIS_TEXT_MAX, (stored ?? "").length);

export function HypothesisFields({
  form,
  today,
  stored,
}: {
  form: HypothesisFormState;
  today: string;
  /** The saved row, when editing: a line it never had (a hand-off draft) isn't required yet. */
  stored?: Hypothesis;
}) {
  const { draft, update, errors } = form;
  const resolved = isResolved(draft.status);
  // A hand-off draft's blank line may stay blank while it is drafted.
  const required = (key: "willDo" | "successMetric" | "toLearn") =>
    !stored || !isBlank(stored[key]) || (key !== "toLearn" && draft.status !== "drafted");

  const line = (
    key: "believe" | "willDo" | "toLearn" | "successMetric" | "experiment",
    label: string,
    placeholder: string,
    opts: { hint?: string; required?: boolean } = {}
  ) => (
    <Field label={label} hint={opts.hint} error={errors[key]} required={opts.required}>
      {(props) => (
        <Input
          {...props}
          maxLength={capFor(stored?.[key])}
          value={draft[key]}
          onChange={(e) => update({ [key]: e.target.value } as Partial<HypothesisDraft>)}
          placeholder={placeholder}
        />
      )}
    </Field>
  );

  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {line("believe", "We believe", "that teams will pay for a weekly report", {
          required: true,
        })}
        {line("willDo", "We will", "show a report preview to 20 teams", {
          required: required("willDo"),
        })}
        {line("toLearn", "To learn", "whether admins ask for it", {
          required: required("toLearn"),
        })}
        {line("successMetric", "Success looks like", "a third of teams ask for the report", {
          required: required("successMetric"),
          hint: "In words; add a number below to get a suggested verdict.",
        })}
      </div>

      <fieldset className="min-w-0 space-y-2 rounded-md border border-border p-3">
        <legend className="px-1 text-sm text-text">Numeric target (optional)</legend>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field
            label="The number should"
            error={errors.direction}
            className="col-span-2 md:col-span-1"
          >
            {(props) => (
              <select
                {...props}
                className={SELECT_CLASS}
                value={draft.direction}
                onChange={(e) => update({ direction: e.target.value as MetricDirection | "" })}
              >
                <option value="">No number</option>
                <option value="increase">{DIRECTION_LABEL.increase}</option>
                <option value="decrease">{DIRECTION_LABEL.decrease}</option>
              </select>
            )}
          </Field>
          <Field label="Target" error={errors.targetValue} required={Boolean(draft.direction)}>
            {(props) => (
              <Input
                {...props}
                inputMode="decimal"
                value={draft.targetValue}
                onChange={(e) => update({ targetValue: e.target.value })}
                placeholder="12"
              />
            )}
          </Field>
          <Field label="Unit" error={errors.unit}>
            {(props) => (
              <Input
                {...props}
                maxLength={HYPOTHESIS_UNIT_MAX}
                value={draft.unit}
                onChange={(e) => update({ unit: e.target.value })}
                placeholder="%"
              />
            )}
          </Field>
          <Field label="Baseline" hint="Where it stands now." error={errors.baseline}>
            {(props) => (
              <Input
                {...props}
                inputMode="decimal"
                value={draft.baseline}
                onChange={(e) => update({ baseline: e.target.value })}
                placeholder="10"
              />
            )}
          </Field>
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {line("experiment", "Experiment", "A fake-door button for two weeks", {
          hint: "Optional. How the test runs.",
        })}
        <Field label="Context" hint="Optional. A link, the rationale." error={errors.description}>
          {(props) => (
            <Textarea
              {...props}
              rows={2}
              maxLength={capFor(stored?.description)}
              value={draft.description}
              onChange={(e) => update({ description: e.target.value })}
              className="resize-none"
            />
          )}
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field label="Status" error={errors.status} className="col-span-2 md:col-span-1">
          {(props) => (
            <select
              {...props}
              className={SELECT_CLASS}
              value={draft.status}
              onChange={(e) =>
                update({
                  status: e.target.value as HypothesisDraft["status"],
                  // A result's day starts as today once there is a result.
                  ...(isResolved(e.target.value as HypothesisDraft["status"]) && !draft.resolvedAt
                    ? { resolvedAt: today }
                    : {}),
                })
              }
            >
              {HYPOTHESIS_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field
          label="Raised on"
          hint="Move it back if the test started earlier."
          error={errors.raisedAt}
          required
        >
          {(props) => (
            <Input
              {...props}
              type="date"
              max={today}
              value={draft.raisedAt}
              onChange={(e) => update({ raisedAt: e.target.value })}
            />
          )}
        </Field>
        {resolved && (
          <Field label="Result on" error={errors.resolvedAt} required>
            {(props) => (
              <Input
                {...props}
                type="date"
                min={draft.raisedAt || undefined}
                max={today}
                value={draft.resolvedAt}
                onChange={(e) => update({ resolvedAt: e.target.value })}
              />
            )}
          </Field>
        )}
        {/* Shown while it holds a value, too: with "No number" picked a stored
            result is refused, and its error needs a field to sit under. */}
        {(draft.direction || !isBlank(draft.actual)) && (
          <Field
            label="Measured result"
            hint={draft.direction ? "Blank until measured." : "Clear it to save without a target."}
            error={errors.actual}
          >
            {(props) => (
              <Input
                {...props}
                inputMode="decimal"
                value={draft.actual}
                onChange={(e) => update({ actual: e.target.value })}
              />
            )}
          </Field>
        )}
      </div>

      <Field label="What we learned" hint="Optional." error={errors.outcome}>
        {(props) => (
          <Textarea
            {...props}
            rows={2}
            maxLength={capFor(stored?.outcome)}
            value={draft.outcome}
            onChange={(e) => update({ outcome: e.target.value })}
            className="resize-none"
          />
        )}
      </Field>
    </>
  );
}
