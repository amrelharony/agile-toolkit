"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  ScalePicker,
  focusFirstInvalid,
  offScale,
  toNumber,
  type ScaleStep,
} from "@/components/prioritization/scale-picker";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";

/** RICE impact per person reached (Intercom's scale). */
export const IMPACT_STEPS: readonly ScaleStep[] = [
  { value: 3, name: "Massive", meaning: "Massive change for each person" },
  { value: 2, name: "High", meaning: "High change for each person" },
  { value: 1, name: "Medium", meaning: "Medium change for each person" },
  { value: 0.5, name: "Low", meaning: "Low change for each person" },
  { value: 0.25, name: "Minimal", meaning: "Minimal change for each person" },
];

/** RICE confidence, as a percentage. */
export const CONFIDENCE_STEPS: readonly ScaleStep[] = [
  { value: 100, name: "High", meaning: "Backed by data" },
  { value: 80, name: "Medium", meaning: "Some evidence" },
  { value: 50, name: "Low", meaning: "Mostly a guess" },
];

const pct = (v: number) => `${v}%`;

type Fields = NonNullable<PrioritizationItem["fields"]>;

/**
 * Where a row keeps its confidence. The UI writes `confidence`; rows saved
 * through the MCP `persist` actions carry `confidencePct`. Edits write back
 * to whichever key the row already has, so its stored shape doesn't change.
 */
export function confidenceKey(fields: Fields | undefined): "confidence" | "confidencePct" {
  return fields && !("confidence" in fields) && "confidencePct" in fields
    ? "confidencePct"
    : "confidence";
}

export function confidenceOf(fields: Fields | undefined): number | undefined {
  return toNumber(fields?.[confidenceKey(fields)]);
}

/** The add or edit form's inputs, before they're checked. */
export interface RiceDraft {
  reach: string;
  impact: number | null;
  confidence: number | null;
  effort: string;
}

export const EMPTY_RICE_DRAFT: RiceDraft = {
  reach: "",
  impact: null,
  confidence: null,
  effort: "",
};

/** Off-scale values the item held, kept on offer as "Custom". */
export interface RiceCustom {
  impact: number | null;
  confidence: number | null;
}

export const NO_CUSTOM: RiceCustom = { impact: null, confidence: null };

export interface RiceValues {
  reach: number;
  impact: number;
  confidence: number;
  effort: number;
}

export type RiceErrors = Partial<Record<keyof RiceDraft, string>>;

const str = (v: unknown) => {
  const n = toNumber(v);
  return n === undefined ? "" : String(n);
};

/** A draft from stored fields or a backlog prefill. */
export function riceDraftFrom(fields: Fields | undefined): RiceDraft {
  return {
    reach: str(fields?.reach),
    impact: toNumber(fields?.impact) ?? null,
    confidence: confidenceOf(fields) ?? null,
    effort: str(fields?.effort),
  };
}

export function riceCustomFrom(draft: RiceDraft): RiceCustom {
  return {
    impact: offScale(IMPACT_STEPS, draft.impact),
    confidence: offScale(CONFIDENCE_STEPS, draft.confidence),
  };
}

/** Check a draft. Blank values are errors, never silent defaults. */
export function validateRice(
  d: RiceDraft
): { ok: true; values: RiceValues } | { ok: false; errors: RiceErrors } {
  const errors: RiceErrors = {};
  const reach = d.reach.trim() === "" ? undefined : Number(d.reach);
  const effort = d.effort.trim() === "" ? undefined : Number(d.effort);
  if (reach === undefined) errors.reach = "Enter the reach.";
  else if (!Number.isFinite(reach) || reach < 0) errors.reach = "Reach must be 0 or more.";
  if (d.impact === null) errors.impact = "Pick an impact.";
  if (d.confidence === null) errors.confidence = "Pick a confidence.";
  if (effort === undefined) errors.effort = "Enter the effort.";
  else if (!Number.isFinite(effort) || effort <= 0) errors.effort = "Effort must be more than 0.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: {
      reach: reach as number,
      impact: d.impact as number,
      confidence: d.confidence as number,
      effort: effort as number,
    },
  };
}

/** True when `values` are what `fields` already hold. */
export function sameRiceValues(fields: Fields | undefined, values: RiceValues): boolean {
  return (
    toNumber(fields?.reach) === values.reach &&
    toNumber(fields?.impact) === values.impact &&
    confidenceOf(fields) === values.confidence &&
    toNumber(fields?.effort) === values.effort
  );
}

/** `fields` with the new values, keeping any other keys and the confidence key. */
export function withRiceValues(fields: Fields | undefined, values: RiceValues): Fields {
  return {
    ...fields,
    reach: values.reach,
    impact: values.impact,
    [confidenceKey(fields)]: values.confidence,
    effort: values.effort,
  };
}

/** Reach, impact, confidence and effort, for the add form and the row editor. */
export function RiceInputs({
  draft,
  onChange,
  errors,
  custom,
  size = "md",
}: {
  draft: RiceDraft;
  onChange: (patch: Partial<RiceDraft>) => void;
  errors: RiceErrors;
  custom: RiceCustom;
  size?: "sm" | "md";
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Reach (people per quarter)" error={errors.reach}>
        {(props) => (
          <Input
            {...props}
            type="number"
            min={0}
            inputMode="numeric"
            value={draft.reach}
            onChange={(e) => onChange({ reach: e.target.value })}
          />
        )}
      </Field>
      <Field label="Effort (person-months)" error={errors.effort}>
        {(props) => (
          <Input
            {...props}
            type="number"
            min={0}
            step={0.5}
            inputMode="decimal"
            value={draft.effort}
            onChange={(e) => onChange({ effort: e.target.value })}
          />
        )}
      </Field>
      <ScalePicker
        label="Impact"
        size={size}
        steps={IMPACT_STEPS}
        value={draft.impact}
        custom={custom.impact}
        onValueChange={(impact) => onChange({ impact })}
        hint="How much it moves the goal for each person reached, from 3× (massive) down to 0.25× (minimal)."
        error={errors.impact}
      />
      <ScalePicker
        label="Confidence"
        size={size}
        steps={CONFIDENCE_STEPS}
        format={pct}
        value={draft.confidence}
        custom={custom.confidence}
        onValueChange={(confidence) => onChange({ confidence })}
        hint="How sure you are of the other numbers: 100% backed by data, 80% some evidence, 50% mostly a guess."
        error={errors.confidence}
      />
    </div>
  );
}

/**
 * Inline editor for a ranked row's scores. Enter saves, Escape cancels;
 * a value that isn't on the scale stays as it is unless a new one is picked.
 */
export function RiceRowEditor({
  row,
  onSave,
  onCancel,
}: {
  row: PrioritizationItem;
  onSave: (values: RiceValues) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => riceDraftFrom(row.fields));
  const [custom] = useState(() => riceCustomFrom(riceDraftFrom(row.fields)));
  const [errors, setErrors] = useState<RiceErrors>({});
  const [attempt, setAttempt] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const cancelRef = useRef(onCancel);
  useEffect(() => {
    cancelRef.current = onCancel;
  });

  // Open on the first input; Escape anywhere in the editor cancels.
  useEffect(() => {
    const form = formRef.current;
    form?.querySelector<HTMLElement>("input")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      cancelRef.current();
    };
    form?.addEventListener("keydown", onKey);
    return () => form?.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (attempt > 0) focusFirstInvalid(formRef.current);
  }, [attempt]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const result = validateRice(draft);
    if (!result.ok) {
      setErrors(result.errors);
      setAttempt((n) => n + 1);
      return;
    }
    onSave(result.values);
  }

  return (
    <form
      ref={formRef}
      aria-label={`Edit scores for ${row.title}`}
      onSubmit={submit}
      noValidate
      className="space-y-3 rounded-md border border-accent/30 bg-accent/5 p-3"
    >
      <RiceInputs
        draft={draft}
        custom={custom}
        errors={errors}
        size="sm"
        onChange={(patch) => {
          setDraft((d) => ({ ...d, ...patch }));
          setErrors((prev) => {
            const next = { ...prev };
            for (const key of Object.keys(patch)) delete next[key as keyof RiceDraft];
            return next;
          });
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm">
          Save
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
