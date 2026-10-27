"use client";

import { Check } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { ScalePicker, type ScaleStep } from "@/components/shared/scale-picker";
import { CHECK_IN_NOTE_MAX, CONFIDENCE_BAND_LABEL, confidenceBand } from "@/lib/okrs/progress";
import type { KeyResult, KeyResultCheckIn } from "@/lib/stores/workspace-types";
import { emptyCheckIn, validateCheckIn, type CheckInDraft, type CheckInField } from "./forms";

/** 0–10, each step named by the band it reads in (lib/okrs confidenceBand). */
export const CONFIDENCE_STEPS: readonly ScaleStep[] = Array.from({ length: 11 }, (_, value) => ({
  value,
  meaning: `${CONFIDENCE_BAND_LABEL[confidenceBand(value) ?? "at-risk"]}: ${
    value === 0 ? "no chance" : value === 10 ? "certain" : `${value} in 10`
  } of reaching the target.`,
}));

/**
 * One check-in on a key result: the value on a day (today to start with,
 * backdated for a missed week, never in the future), and optionally how
 * sure the owner is of reaching the target. Confidence starts unscored.
 */
export function CheckInForm({
  kr,
  today,
  now,
  onSave,
  onCancel,
}: {
  kr: KeyResult;
  today: string;
  /** What the key result reads now, for the value's hint. */
  now: string;
  onSave: (values: Omit<KeyResultCheckIn, "id">) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<CheckInDraft, Omit<KeyResultCheckIn, "id">, CheckInField>({
    initial: () => emptyCheckIn(today),
    validate: (d) => validateCheckIn(d, today, kr),
    onSave,
    resetOnSave: false,
  });
  const { draft, update, errors } = form;
  const title = kr.title || "key result";
  return (
    <ItemForm
      form={form}
      submitLabel="Save check-in"
      submitIcon={<Check className="h-4 w-4" aria-hidden="true" />}
      onCancel={onCancel}
      className="rounded-md border border-border bg-surface p-3"
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[10rem_10rem_minmax(0,1fr)]">
        <Field label="Day" error={errors.date} required>
          {(props) => (
            <Input
              {...props}
              type="date"
              max={today}
              value={draft.date}
              onChange={(e) => update({ date: e.target.value })}
            />
          )}
        </Field>
        <Field
          label={`Value${kr.unit ? ` (${kr.unit})` : ""}`}
          hint={`Now: ${now}`}
          error={errors.value}
          required
        >
          {(props) => (
            <Input
              {...props}
              type="number"
              inputMode="decimal"
              value={draft.value}
              onChange={(e) => update({ value: e.target.value })}
              className="font-data"
              aria-label={`Value for ${title}`}
            />
          )}
        </Field>
        <Field label="Note" error={errors.note} className="col-span-2 sm:col-span-1">
          {(props) => (
            <Input
              {...props}
              value={draft.note}
              maxLength={CHECK_IN_NOTE_MAX}
              onChange={(e) => update({ note: e.target.value })}
              placeholder="What moved it (optional)"
            />
          )}
        </Field>
      </div>
      <ScalePicker
        label="Confidence"
        steps={CONFIDENCE_STEPS}
        value={draft.confidence}
        onValueChange={(confidence) => update({ confidence })}
        onClear={() => update({ confidence: null })}
        hint="Optional: how sure is the owner of reaching the target? 0–3 off track, 4–6 at risk, 7–10 on track."
        error={errors.confidence}
        size="sm"
        optionsClassName="grid grid-cols-6 sm:inline-flex"
      />
    </ItemForm>
  );
}
