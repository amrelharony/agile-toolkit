"use client";

/**
 * A test's details for saving: its name, the question it answers, the
 * metric it moves (typed, or one of Product Metrics' own), the hypothesis
 * it tests and its status. view.ts' validateDetails checks them.
 */

import type { ItemFormState } from "@/components/shared/item-form";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Hypothesis, ProductMetric } from "@/lib/stores/workspace-types";
import { AB_TEST_STATUSES, TOOL_TEXT_MAX } from "@/lib/stores/workspace-types";
import { STATUS_LABEL } from "@/lib/experiments/model";
import { ToggleField } from "./plan-fields";
import type { DetailsDraft, DetailsField } from "./view";

/** Matches <Input>: 44 px / 16 px on touch, 36 px / 14 px for a mouse at md+. */
export const SELECT_CLASS =
  "flex h-11 pointer-fine:md:h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-base pointer-fine:md:text-sm text-text shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const short = (s: string, max = 70) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

export function DetailsFields({
  form,
  hypotheses,
  metrics,
}: {
  form: ItemFormState<DetailsDraft, DetailsField>;
  hypotheses: readonly Hypothesis[];
  metrics: readonly ProductMetric[];
}) {
  const { draft, update, errors } = form;
  // A link to a row that's gone stays selectable, so saving doesn't drop it silently.
  const lostHypothesis = draft.hypothesisId && !hypotheses.some((h) => h.id === draft.hypothesisId);
  const lostMetric = draft.metricId && !metrics.some((m) => m.id === draft.metricId);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Test name" error={errors.name} required>
          {(props) => (
            <Input
              {...props}
              maxLength={TOOL_TEXT_MAX.short}
              value={draft.name}
              placeholder="e.g. Shorter sign-up form"
              onChange={(e) => update({ name: e.target.value })}
            />
          )}
        </Field>
        <Field label="Main metric" error={errors.metricName}>
          {(props) => (
            <Input
              {...props}
              maxLength={TOOL_TEXT_MAX.short}
              value={draft.metricName}
              placeholder="e.g. sign-up conversion"
              onChange={(e) => update({ metricName: e.target.value })}
            />
          )}
        </Field>
      </div>
      <Field label="Question it answers" error={errors.question}>
        {(props) => (
          <Textarea
            {...props}
            rows={2}
            maxLength={TOOL_TEXT_MAX.text}
            value={draft.question}
            placeholder="e.g. Does a shorter form get more visitors to sign up?"
            className="resize-none"
            onChange={(e) => update({ question: e.target.value })}
          />
        )}
      </Field>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Product metric (optional)">
          {(props) => (
            <select
              {...props}
              className={SELECT_CLASS}
              value={draft.metricId}
              onChange={(e) => update({ metricId: e.target.value })}
            >
              <option value="">None</option>
              {lostMetric && <option value={draft.metricId}>Metric removed</option>}
              {metrics.map((m) => (
                <option key={m.id} value={m.id}>
                  {short(m.name)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Hypothesis it tests (optional)">
          {(props) => (
            <select
              {...props}
              className={SELECT_CLASS}
              value={draft.hypothesisId}
              onChange={(e) => update({ hypothesisId: e.target.value })}
            >
              <option value="">None</option>
              {lostHypothesis && <option value={draft.hypothesisId}>Hypothesis removed</option>}
              {hypotheses.map((h) => (
                <option key={h.id} value={h.id}>
                  {short(h.believe || "Untitled hypothesis")}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <ToggleField
        label="Status"
        value={draft.status}
        onChange={(status) => update({ status })}
        options={AB_TEST_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
      />
    </div>
  );
}
