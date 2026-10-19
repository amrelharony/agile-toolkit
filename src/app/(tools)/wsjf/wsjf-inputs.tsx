"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  ScalePicker,
  focusFirstInvalid,
  offScale,
  toNumber,
  type ScaleStep,
} from "@/components/prioritization/scale-picker";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";

/** The modified Fibonacci scale WSJF scores each component on, relative to the others. */
export const FIBONACCI_STEPS: readonly ScaleStep[] = [
  { value: 1, meaning: "Smallest in the set" },
  { value: 2 },
  { value: 3 },
  { value: 5 },
  { value: 8 },
  { value: 13 },
  { value: 20, meaning: "Largest in the set" },
];

export const WSJF_KEYS = ["businessValue", "timeCriticality", "rrOe", "jobSize"] as const;
export type WsjfKey = (typeof WSJF_KEYS)[number];

export const WSJF_COMPONENTS: Record<WsjfKey, { label: string; hint: string; error: string }> = {
  businessValue: {
    label: "Business value",
    hint: "Value to users or the business.",
    error: "Pick a business value.",
  },
  timeCriticality: {
    label: "Time criticality",
    hint: "How fast the value drops if it waits.",
    error: "Pick a time criticality.",
  },
  rrOe: {
    label: "Risk reduction / opportunity enablement",
    hint: "Risk it removes or options it opens.",
    error: "Pick a risk reduction score.",
  },
  jobSize: {
    label: "Job size",
    hint: "Work it takes, relative to the others.",
    error: "Pick a job size.",
  },
};

export const WSJF_LEGEND =
  "Score each feature against the others: 1 is the smallest in the set, 3 to 8 in between, 13 and 20 the largest.";

type Fields = NonNullable<PrioritizationItem["fields"]>;

/** The four components, each null until picked. */
export type WsjfDraft = Record<WsjfKey, number | null>;
export type WsjfValues = Record<WsjfKey, number>;
export type WsjfErrors = Partial<Record<WsjfKey, string>>;

export const EMPTY_WSJF_DRAFT: WsjfDraft = {
  businessValue: null,
  timeCriticality: null,
  rrOe: null,
  jobSize: null,
};

/** A draft from stored fields or a backlog prefill. */
export function wsjfDraftFrom(fields: Fields | undefined): WsjfDraft {
  const out = { ...EMPTY_WSJF_DRAFT };
  for (const key of WSJF_KEYS) out[key] = toNumber(fields?.[key]) ?? null;
  return out;
}

/** Off-scale values the item held, kept on offer as "Custom". */
export function wsjfCustomFrom(draft: WsjfDraft): WsjfDraft {
  const out = { ...EMPTY_WSJF_DRAFT };
  for (const key of WSJF_KEYS) out[key] = offScale(FIBONACCI_STEPS, draft[key]);
  return out;
}

/** Check a draft: every component needs a value; none defaults silently. */
export function validateWsjf(
  d: WsjfDraft
): { ok: true; values: WsjfValues } | { ok: false; errors: WsjfErrors } {
  const errors: WsjfErrors = {};
  for (const key of WSJF_KEYS) if (d[key] === null) errors[key] = WSJF_COMPONENTS[key].error;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, values: d as WsjfValues };
}

/** True when `values` are what `fields` already hold. */
export function sameWsjfValues(fields: Fields | undefined, values: WsjfValues): boolean {
  return WSJF_KEYS.every((key) => toNumber(fields?.[key]) === values[key]);
}

/** The four component pickers and their legend, for the add form and the row editor. */
export function WsjfInputs({
  draft,
  onChange,
  errors,
  custom,
  size = "md",
}: {
  draft: WsjfDraft;
  onChange: (patch: Partial<WsjfDraft>) => void;
  errors: WsjfErrors;
  custom: WsjfDraft;
  size?: "sm" | "md";
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {WSJF_KEYS.map((key) => (
          <ScalePicker
            key={key}
            label={WSJF_COMPONENTS[key].label}
            size={size}
            steps={FIBONACCI_STEPS}
            value={draft[key]}
            custom={custom[key]}
            onValueChange={(v) => onChange({ [key]: v })}
            hint={WSJF_COMPONENTS[key].hint}
            error={errors[key]}
          />
        ))}
      </div>
      <p className="text-xs text-sub">{WSJF_LEGEND}</p>
    </div>
  );
}

/** Drop the errors for the keys a change touched. */
export function clearErrors<E extends object>(prev: E, patch: object): E {
  const next = { ...prev };
  for (const key of Object.keys(patch)) delete next[key as keyof E];
  return next;
}

/**
 * Inline editor for a ranked row's scores. Save writes them, Escape cancels;
 * a value that isn't on the scale stays as it is unless a new one is picked.
 */
export function WsjfRowEditor({
  row,
  onSave,
  onCancel,
}: {
  row: PrioritizationItem;
  onSave: (values: WsjfValues) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => wsjfDraftFrom(row.fields));
  const [custom] = useState(() => wsjfCustomFrom(wsjfDraftFrom(row.fields)));
  const [errors, setErrors] = useState<WsjfErrors>({});
  const [attempt, setAttempt] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const cancelRef = useRef(onCancel);
  useEffect(() => {
    cancelRef.current = onCancel;
  });

  // Open on the first scale; Escape anywhere in the editor cancels.
  useEffect(() => {
    const form = formRef.current;
    form?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')?.focus();
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
    const result = validateWsjf(draft);
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
      <WsjfInputs
        draft={draft}
        custom={custom}
        errors={errors}
        size="sm"
        onChange={(patch) => {
          setDraft((d) => ({ ...d, ...patch }));
          setErrors((prev) => clearErrors(prev, patch));
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
