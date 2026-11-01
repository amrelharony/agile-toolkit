"use client";

import type { ReactNode } from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { QuarterPicker } from "@/components/shared/quarter-picker";
import type { ItemFormState } from "@/components/shared/item-form";
import { DORA_DESCRIPTION_MAX } from "@/lib/dora/samples";
import { currentQuarterIndex, dashQuarter } from "@/lib/roadmap/quarters";
import type { DoraDraft, DoraDraftField } from "./form";

/** How many years back the quarter picker reaches. */
export const DORA_YEARS_BACK = 6;

/** One numeric field: text with a decimal keypad, so a typed "1." isn't snapped away mid-edit. */
function NumberField({
  form,
  field,
  label,
  hint,
  placeholder,
}: {
  form: ItemFormState<DoraDraft, DoraDraftField>;
  field: "deployFreqPerWeek" | "leadTimeHours" | "changeFailRatePct" | "mttrHours";
  label: string;
  hint: ReactNode;
  placeholder: string;
}) {
  return (
    <Field label={label} hint={hint} error={form.errors[field]} required>
      {(props) => (
        <Input
          {...props}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={form.draft[field]}
          onChange={(e) => form.update({ [field]: e.target.value } as Partial<DoraDraft>)}
          placeholder={placeholder}
          className="font-data"
        />
      )}
    </Field>
  );
}

/**
 * The quarter, the four DORA numbers and a note: the fields of both the
 * "Log a quarter" form and a row's editor. `quarterNote` sits under the
 * picker (the "already logged: edit it" path); `metricNote` under a metric
 * (why "Fill from your data" couldn't work it out).
 */
export function SampleFields({
  form,
  now,
  logged,
  quarterNote,
  metricNote,
  quarterRef,
}: {
  form: ItemFormState<DoraDraft, DoraDraftField>;
  now: Date;
  /** Quarters that already have a sample, tagged in the picker. */
  logged: ReadonlySet<string>;
  quarterNote?: ReactNode;
  metricNote?: (field: DoraDraftField) => ReactNode;
  quarterRef?: (el: HTMLSelectElement | null) => void;
}) {
  const note = (field: DoraDraftField, hint: ReactNode) => {
    const extra = metricNote?.(field);
    return extra ? (
      <>
        {hint} {extra}
      </>
    ) : (
      hint
    );
  };
  return (
    <div className="space-y-3">
      <div>
        <QuarterPicker
          label="Quarter"
          format="dash"
          value={form.draft.quarter}
          onChange={(quarter) => form.update({ quarter })}
          now={now}
          // A quarter that hasn't started can't be measured; the one still
          // running can, over the weeks so far, and says so.
          latest={dashQuarter(currentQuarterIndex(now))}
          currentLabel="in progress"
          // Six years of history to backdate (the roadmap's pickers offer two).
          yearsBack={DORA_YEARS_BACK}
          selectRef={quarterRef}
          also={Array.from(logged)}
          marked={logged}
          markLabel="logged"
          error={form.errors.quarter}
          required
        />
        {quarterNote}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <NumberField
          form={form}
          field="deployFreqPerWeek"
          label="Deploys a week"
          hint={note("deployFreqPerWeek", "Deployments to production, per week.")}
          placeholder="e.g. 4"
        />
        <NumberField
          form={form}
          field="leadTimeHours"
          label="Lead time (hours)"
          hint={note("leadTimeHours", "Commit (or start of work) to production. 24 h is a day.")}
          placeholder="e.g. 36"
        />
        <NumberField
          form={form}
          field="changeFailRatePct"
          label="Change failure rate (%)"
          hint={note("changeFailRatePct", "Deployments that needed a fix or a rollback.")}
          placeholder="e.g. 12"
        />
        <NumberField
          form={form}
          field="mttrHours"
          label="Time to restore (hours)"
          hint={note("mttrHours", "From a failure in production to service restored.")}
          placeholder="e.g. 3"
        />
      </div>
      <Field label="What changed this quarter (optional)" error={form.errors.description}>
        {(props) => (
          <Textarea
            {...props}
            value={form.draft.description}
            onChange={(e) => form.update({ description: e.target.value })}
            placeholder="A new pipeline, a major incident, a team change…"
            rows={2}
            maxLength={DORA_DESCRIPTION_MAX}
            className="resize-y text-sm"
          />
        )}
      </Field>
    </div>
  );
}
