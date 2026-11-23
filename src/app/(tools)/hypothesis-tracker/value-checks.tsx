"use client";

/**
 * Value checks (P2.5): "Shipped work to check" lists stories done and
 * epics finished in the last 90 days that no hypothesis checks yet; "Check
 * its value" opens a form with four lines pre-filled in our words, how it
 * is measured (a product metric, a key result or in words), when to look
 * (7 to 90 days after it shipped) and a target, which a metric or a key
 * result needs. It saves as a running hypothesis through lib/hypotheses'
 * validateValueCheck, the same check the agent's add_value_check runs.
 * The measure picker is shared with the card's "Measured by" editor.
 */

import { useEffect, useRef, useState } from "react";
import { PackageCheck, Plus } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup } from "@/components/ui/toggle-group";
import type {
  HypothesisMeasuredBy,
  MeasuredByKind,
  MetricDirection,
  Okr,
  ProductMetric,
} from "@/lib/stores/workspace-types";
import { HYPOTHESIS_TEXT_MAX, HYPOTHESIS_UNIT_MAX } from "@/lib/hypotheses/model";
import {
  MEASURED_NOTE_MAX,
  TRACKER_FULL,
  VALUE_CHECK_DAYS,
  keyResultRef,
  measureDefaults,
  measuredByOf,
  validateValueCheck,
  valueCheckDraft,
  type ShippedCandidate,
  type ValueCheckDraft,
  type ValueCheckField,
  type ValueCheckValues,
} from "@/lib/hypotheses/value";
import { addDays } from "@/lib/flow/days";
import type { FormErrors } from "@/lib/utils/form";
import { SELECT_CLASS } from "./hypothesis-fields";

const MEASURE_LABEL: Record<MeasuredByKind, string> = {
  metric: "A product metric",
  "key-result": "A key result",
  words: "In words",
};

const short = (s: string, max = 70) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** The metric, the key result or the words a hypothesis is measured by. */
export interface MeasureDraft {
  measuredKind: MeasuredByKind;
  metricId: string;
  keyResult: string;
  note: string;
}

export const measureDraftFrom = (m: HypothesisMeasuredBy | undefined): MeasureDraft => ({
  measuredKind: m?.kind ?? "words",
  metricId: m?.metricId ?? "",
  keyResult: m?.okrId && m.keyResultId ? keyResultRef(m.okrId, m.keyResultId) : "",
  note: m?.note ?? "",
});

/** "Measured by": the kind, then the metric, the key result or the words. */
export function MeasureChoice({
  draft,
  onChange,
  errors,
  metrics,
  okrs,
}: {
  draft: MeasureDraft;
  onChange: (patch: Partial<MeasureDraft>) => void;
  errors: Partial<Record<keyof MeasureDraft, string>>;
  metrics: readonly ProductMetric[];
  okrs: readonly Okr[];
}) {
  const keyResults = okrs.flatMap((o) =>
    (o.keyResults ?? []).map((kr) => ({
      ref: keyResultRef(o.id, kr.id),
      label: `${short(kr.title || "Untitled key result", 50)} (${short(o.objective || "an objective", 30)})`,
    }))
  );
  return (
    <div className="space-y-2">
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-sm text-text" aria-hidden="true">
          Measured by
        </span>
        <ToggleGroup
          label="Measured by"
          size="sm"
          value={draft.measuredKind}
          onValueChange={(measuredKind) => onChange({ measuredKind })}
          options={(Object.keys(MEASURE_LABEL) as MeasuredByKind[]).map((k) => ({
            value: k,
            label: MEASURE_LABEL[k],
          }))}
        />
      </div>
      {draft.measuredKind === "metric" && (
        <Field
          label="Product metric"
          error={errors.metricId}
          hint={
            metrics.length === 0
              ? "Add one in Product Metrics first, or measure it in words."
              : undefined
          }
        >
          {(props) => (
            <select
              {...props}
              className={SELECT_CLASS}
              value={draft.metricId}
              onChange={(e) => onChange({ metricId: e.target.value })}
            >
              <option value="">Pick a metric</option>
              {metrics.map((m) => (
                <option key={m.id} value={m.id}>
                  {short(m.name || "Untitled metric")}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      {draft.measuredKind === "key-result" && (
        <Field
          label="Key result"
          error={errors.keyResult}
          hint={
            keyResults.length === 0
              ? "Add one in the OKR Tracker first, or measure it in words."
              : undefined
          }
        >
          {(props) => (
            <select
              {...props}
              className={SELECT_CLASS}
              value={draft.keyResult}
              onChange={(e) => onChange({ keyResult: e.target.value })}
            >
              <option value="">Pick a key result</option>
              {keyResults.map((k) => (
                <option key={k.ref} value={k.ref}>
                  {k.label}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      {draft.measuredKind === "words" && (
        <Field label="How you'll tell" error={errors.note}>
          {(props) => (
            <Input
              {...props}
              maxLength={MEASURED_NOTE_MAX}
              value={draft.note}
              placeholder="fewer support tickets about sign-up"
              onChange={(e) => onChange({ note: e.target.value })}
            />
          )}
        </Field>
      )}
    </div>
  );
}

/** The card's "Measured by" editor: save a measure, or clear it. */
export function MeasuredByEditor({
  current,
  metrics,
  okrs,
  onSave,
  onCancel,
}: {
  current: HypothesisMeasuredBy | undefined;
  metrics: readonly ProductMetric[];
  okrs: readonly Okr[];
  onSave: (m: HypothesisMeasuredBy | null) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<MeasureDraft>(() => measureDraftFrom(current));
  const [error, setError] = useState<{ field: keyof MeasureDraft; text: string } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[role=radio][aria-checked=true]")?.focus();
  }, []);
  const save = () => {
    const r = measuredByOf(draft, { metrics, okrs });
    if (!r.ok) {
      setError({ field: r.field as keyof MeasureDraft, text: r.error });
      requestAnimationFrame(() =>
        ref.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      );
      return;
    }
    onSave(r.measuredBy);
  };
  return (
    <div ref={ref} className="space-y-2 rounded-md border border-accent/40 bg-card p-2.5">
      <MeasureChoice
        draft={draft}
        onChange={(patch) => {
          setDraft((d) => ({ ...d, ...patch }));
          setError(null);
        }}
        errors={error ? { [error.field]: error.text } : {}}
        metrics={metrics}
        okrs={okrs}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={save}>
          Save measure
        </Button>
        {current && (
          <Button type="button" size="sm" variant="outline" onClick={() => onSave(null)}>
            Clear it
          </Button>
        )}
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

const DIRECTION_LABEL: Record<MetricDirection, string> = {
  increase: "Rise to at least",
  decrease: "Fall to at most",
};

const KIND_LABEL = { story: "Story", epic: "Epic" } as const;

/** How many candidates show before "Show all". */
const SHOWN = 5;

/** The element whose `attr` is `value`; values go in no selector, so need no escaping. */
const markedWith = (attr: string, value: string) =>
  Array.from(document.querySelectorAll<HTMLElement>(`[${attr}]`)).find(
    (el) => el.getAttribute(attr) === value
  );

/** Once React has re-rendered, focus the first of these that is on the page. */
function focusFirst(...finders: (() => HTMLElement | null | undefined)[]) {
  requestAnimationFrame(() => {
    for (const find of finders) {
      const el = find();
      if (el) {
        el.focus();
        return;
      }
    }
  });
}

/**
 * "Shipped work to check": the candidates, each with "Check its value",
 * which opens the form in place. Shows nothing while there are none.
 */
export function ShippedWork({
  candidates,
  today,
  metrics,
  okrs,
  onAdd,
}: {
  candidates: readonly ShippedCandidate[];
  today: string;
  metrics: readonly ProductMetric[];
  okrs: readonly Okr[];
  /** Saves the check: its new id, or null when the tracker has no room (nothing saved). */
  onAdd: (values: ValueCheckValues) => string | null;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  /** The open form whose save the tracker refused, being full. */
  const [full, setFull] = useState<string | null>(null);
  if (candidates.length === 0) return null;
  const shown = all ? candidates : candidates.slice(0, SHOWN);
  const keyOf = (c: ShippedCandidate) => `${c.kind}:${c.id}`;
  const open = candidates.find((c) => keyOf(c) === openId) ?? null;
  return (
    <SectionCard
      title={`Shipped work to check (${candidates.length})`}
      icon={PackageCheck}
      contentClassName="space-y-3"
    >
      <p className="text-sm text-sub">
        Stories done and epics finished in the last 90 days. Check its value to find out whether the
        work did what you hoped, some days after it shipped.
      </p>
      <ul className="space-y-2" aria-label="Shipped work to check">
        {shown.map((c) => (
          <li key={keyOf(c)} className="min-w-0 rounded-md border border-border bg-surface p-2.5">
            {openId === keyOf(c) && open ? (
              <>
                <ValueCheckForm
                  candidate={open}
                  today={today}
                  metrics={metrics}
                  okrs={okrs}
                  onSave={(values) => {
                    // Refused: the form stays open with what was typed, and says why.
                    const id = onAdd(values);
                    if (id === null) {
                      setFull(keyOf(c));
                      return;
                    }
                    setFull(null);
                    setOpenId(null);
                    // It leaves the list: on to the next one, else the new card, else New hypothesis.
                    const at = candidates.findIndex((x) => keyOf(x) === keyOf(c));
                    const near = candidates[at + 1] ?? candidates[at - 1];
                    focusFirst(
                      () => (near ? markedWith("data-value-check", keyOf(near)) : undefined),
                      () => markedWith("data-hypothesis-edit", id),
                      () => document.querySelector<HTMLElement>("[data-new-hypothesis]")
                    );
                  }}
                  onCancel={() => {
                    setFull(null);
                    setOpenId(null);
                    focusFirst(() => markedWith("data-value-check", keyOf(c)));
                  }}
                />
                {full === keyOf(c) && (
                  <p role="alert" className="mt-2 break-words text-sm text-danger">
                    {TRACKER_FULL}
                  </p>
                )}
              </>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-words text-sm text-text">{c.title}</p>
                  <p className="text-xs text-sub">
                    {KIND_LABEL[c.kind]} · {c.doneAt ? `done on ${c.doneAt}` : "no done day yet"}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  aria-label={`Check its value: ${c.title}`}
                  // Where focus comes back to when its form closes, or the one before it saves.
                  data-value-check={keyOf(c)}
                  onClick={() => setOpenId(keyOf(c))}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Check its value
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {candidates.length > SHOWN && (
        <Button type="button" variant="ghost" size="sm" onClick={() => setAll((a) => !a)}>
          {all ? "Show fewer" : `Show all ${candidates.length}`}
        </Button>
      )}
    </SectionCard>
  );
}

function ValueCheckForm({
  candidate,
  today,
  metrics,
  okrs,
  onSave,
  onCancel,
}: {
  candidate: ShippedCandidate;
  today: string;
  metrics: readonly ProductMetric[];
  okrs: readonly Okr[];
  onSave: (values: ValueCheckValues) => void;
  onCancel: () => void;
}) {
  const sources = { metrics, okrs };
  const form = useItemForm<ValueCheckDraft, ValueCheckValues, ValueCheckField>({
    initial: () => valueCheckDraft(candidate, today),
    validate: (d) => validateValueCheck(d, today, sources),
    onSave,
    // A save closes the form; one the tracker refuses keeps what was typed.
    resetOnSave: false,
  });
  const { draft, update, errors, formRef } = form;
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("input")?.focus();
  }, [formRef]);
  const checkOn = addDays(draft.shippedOn, draft.lookAfter);

  /** A metric or key result picked: its direction, unit, baseline and target come with it. */
  const pickMeasure = (patch: Partial<ValueCheckDraft>) => {
    const next = { ...draft, ...patch };
    const m = measuredByOf(next, sources);
    const filled =
      m.ok && m.measuredBy.kind !== "words"
        ? measureDefaults(m.measuredBy, sources, next.shippedOn)
        : null;
    update({ ...patch, ...(filled ?? {}) });
  };

  const line = (key: "believe" | "willDo" | "toLearn" | "successMetric", label: string) => (
    <Field label={label} error={errors[key]} required>
      {(props) => (
        <Input
          {...props}
          maxLength={HYPOTHESIS_TEXT_MAX}
          value={draft[key]}
          onChange={(e) => update({ [key]: e.target.value } as Partial<ValueCheckDraft>)}
        />
      )}
    </Field>
  );

  return (
    <ItemForm
      form={form}
      submitLabel="Add value check"
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
      onCancel={onCancel}
    >
      <p className="break-words text-sm font-medium text-text">
        Check its value: {candidate.title}
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {line("believe", "We believe")}
        {line("willDo", "We will")}
        {line("toLearn", "To learn")}
        {line("successMetric", "Success looks like")}
      </div>
      <MeasureChoice
        draft={draft}
        onChange={pickMeasure}
        errors={errors as FormErrors<keyof MeasureDraft>}
        metrics={metrics}
        okrs={okrs}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Shipped on" error={errors.shippedOn} required>
          {(props) => (
            <Input
              {...props}
              type="date"
              max={today}
              value={draft.shippedOn}
              onChange={(e) => update({ shippedOn: e.target.value })}
            />
          )}
        </Field>
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-sm text-text" aria-hidden="true">
            Look after
          </span>
          <ToggleGroup
            label="Look after"
            size="sm"
            value={draft.lookAfter}
            onValueChange={(lookAfter) => update({ lookAfter })}
            options={VALUE_CHECK_DAYS.map((d) => ({ value: d, label: `${d} days` }))}
          />
          {checkOn && <p className="text-xs text-sub">Check on {checkOn}.</p>}
        </div>
      </div>
      <fieldset className="min-w-0 space-y-2 rounded-md border border-border p-3">
        <legend className="px-1 text-sm text-text">
          Target{draft.measuredKind === "words" ? " (optional)" : ""}
        </legend>
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
              />
            )}
          </Field>
          <Field label="Baseline" hint="Where it stood when it shipped." error={errors.baseline}>
            {(props) => (
              <Input
                {...props}
                inputMode="decimal"
                value={draft.baseline}
                onChange={(e) => update({ baseline: e.target.value })}
              />
            )}
          </Field>
        </div>
      </fieldset>
    </ItemForm>
  );
}
