"use client";

import { Save } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { QuarterPicker } from "@/components/shared/quarter-picker";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { currentQuarter } from "@/lib/roadmap/quarters";
import {
  COST_CATEGORIES,
  COST_CATEGORY_LABEL,
  QUALITY_COST_NOTE_MAX,
  costPeriodErrors,
  hoursTimesRate,
  typedCostQuarter,
  type CostCategory,
  type CostFigures,
  type CostPeriodField,
  type QualityCostPeriod,
} from "@/lib/quality/cost";
import { parseNumber, type FormErrors, type Validation } from "@/lib/utils/form";
import { money } from "./view";

/** What each category covers, under its field. */
const HINT: Record<CostCategory, string> = {
  prevention: "Training, code review, design",
  detection: "Testing, inspection, audits. Textbooks call this appraisal.",
  internalFailure: "Rework caught pre-release",
  externalFailure: "Bug fixes, refunds, churn",
};

/** Years of quarters before this one the picker offers, to backdate a history. */
const YEARS_BACK = 5;

type ByCategory<T> = Record<CostCategory, T>;

const each = <T,>(value: T): ByCategory<T> => ({
  prevention: value,
  detection: value,
  internalFailure: value,
  externalFailure: value,
});

export interface PeriodDraft {
  /** The dash quarter picked, or "" before one is. */
  period: string;
  /** Typed amounts: "" for a category not entered. */
  amounts: ByCategory<string>;
  /** Typed hours, for the categories worked out as hours × the rate. */
  hours: ByCategory<string>;
  /** Which categories take hours instead of an amount. */
  byHours: ByCategory<boolean>;
  note: string;
}

export type PeriodField = CostPeriodField | `hours-${CostCategory}` | "note";

export interface PeriodValues {
  period: string;
  costs: CostFigures;
  hours?: Partial<ByCategory<number>>;
  note?: string;
}

export function emptyPeriodDraft(): PeriodDraft {
  return { period: "", amounts: each(""), hours: each(""), byHours: each(false), note: "" };
}

/** A logged quarter as a draft to edit: a cost worked out from hours opens in hours. */
export function draftFromPeriod(p: QualityCostPeriod): PeriodDraft {
  const draft = emptyPeriodDraft();
  draft.period = p.period;
  draft.note = p.note ?? "";
  for (const c of COST_CATEGORIES) {
    const cost = p.costs[c];
    const hours = p.hours?.[c];
    draft.amounts[c] = cost === undefined ? "" : String(cost);
    if (hours !== undefined) {
      draft.hours[c] = String(hours);
      draft.byHours[c] = true;
    }
  }
  return draft;
}

/** "$1,200" and "1 200" as typed money: the symbol and separators go before the number is read. */
const cleanMoney = (raw: string) => raw.replace(/[$,\s]/g, "");

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The cost `saved` (the quarter being edited) holds for category `c` when
 * the draft still takes it as the same hours, or undefined. A logged
 * quarter keeps the price its hours were worked out at: the period stores
 * no rate, so pricing them again at today's rate would quietly rewrite a
 * past quarter on a note-only edit (or block the save once the rate is
 * cleared). Only hours changed in this edit are priced at the current rate.
 */
export function keptHoursCost(
  draft: PeriodDraft,
  c: CostCategory,
  saved: QualityCostPeriod | undefined
): number | undefined {
  if (!saved || !draft.byHours[c]) return undefined;
  const h = parseNumber(draft.hours[c]);
  const was = saved.hours?.[c];
  const cost = saved.costs[c];
  return h !== undefined && h === was && cost !== undefined ? cost : undefined;
}

/**
 * Check a quarter's draft. The quarter and the amounts go through
 * costPeriodErrors (lib/quality/cost); a category taken as hours needs
 * hours of 0 or more and an hourly rate, and its cost is hours × rate
 * (hoursTimesRate), except hours an edit left as `saved` holds them, which
 * keep their stored cost (keptHoursCost). Nothing blank becomes $0.
 */
export function validatePeriod(
  draft: PeriodDraft,
  periods: readonly QualityCostPeriod[],
  hourlyRate: number | undefined,
  editingId?: string,
  saved?: QualityCostPeriod
): Validation<PeriodValues, PeriodField> {
  const errors: FormErrors<PeriodField> = {};
  const typed: Partial<ByCategory<string | number>> = {};
  const hours: Partial<ByCategory<number>> = {};
  for (const c of COST_CATEGORIES) {
    if (!draft.byHours[c]) {
      typed[c] = cleanMoney(draft.amounts[c]);
      continue;
    }
    const h = parseNumber(draft.hours[c]);
    if (h === undefined) continue;
    // A category with hours typed counts as entered, so "Enter at least
    // one cost" doesn't fire beside the hours' own error.
    typed[c] = 0;
    const kept = keptHoursCost(draft, c, saved);
    if (kept !== undefined) {
      typed[c] = kept;
      hours[c] = h;
    } else if (!Number.isFinite(h) || h < 0) errors[`hours-${c}`] = "Enter hours of 0 or more.";
    else if (hourlyRate === undefined) errors[`hours-${c}`] = "Enter the hourly rate first.";
    else {
      const cost = hoursTimesRate(h, hourlyRate);
      if (cost === null) errors[`hours-${c}`] = "Enter hours of 0 or more.";
      else {
        typed[c] = cost;
        hours[c] = h;
      }
    }
  }
  const base = costPeriodErrors({ period: draft.period, costs: typed }, periods, editingId);
  for (const [field, message] of Object.entries(base) as [CostPeriodField, string][]) {
    // The "at least one cost" error sits on the first category: on its hours
    // box when that one is taken as hours.
    if (field !== "period" && draft.byHours[field]) errors[`hours-${field}`] ??= message;
    else errors[field] = message;
  }
  if (draft.note.trim().length > QUALITY_COST_NOTE_MAX) {
    errors.note = `Keep the note to ${QUALITY_COST_NOTE_MAX} characters.`;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const costs: CostFigures = {};
  for (const c of COST_CATEGORIES) {
    const n = parseNumber(typed[c] ?? undefined);
    if (n !== undefined) costs[c] = round2(n);
  }
  const note = draft.note.trim();
  return {
    ok: true,
    values: {
      period: typedCostQuarter(draft.period) as string,
      costs,
      ...(Object.keys(hours).length > 0 ? { hours } : {}),
      ...(note ? { note } : {}),
    },
  };
}

/**
 * The form for one quarter's figures: add (empty, resets after a save) or
 * edit (the quarter's figures; `editing` set). Each category takes an
 * amount, or hours worked out at the hourly rate.
 */
export function PeriodForm({
  periods,
  editing,
  hourlyRate,
  onSave,
  onCancel,
  now = new Date(),
}: {
  periods: readonly QualityCostPeriod[];
  editing?: QualityCostPeriod;
  hourlyRate: number | undefined;
  onSave: (values: PeriodValues) => void;
  onCancel?: () => void;
  now?: Date;
}) {
  const form = useItemForm<PeriodDraft, PeriodValues, PeriodField>({
    initial: () => (editing ? draftFromPeriod(editing) : emptyPeriodDraft()),
    validate: (d) => validatePeriod(d, periods, hourlyRate, editing?.id, editing),
    onSave: (values) => onSave(values),
    resetOnSave: !editing,
  });
  const { draft, update, errors } = form;
  const logged = new Set(periods.map((p) => p.period));

  const setCategory = (
    key: "amounts" | "hours" | "byHours",
    c: CostCategory,
    value: string | boolean
  ) => update({ [key]: { ...draft[key], [c]: value } } as Partial<PeriodDraft>);

  return (
    <ItemForm
      form={form}
      submitLabel={editing ? `Save ${editing.period}` : "Save quarter"}
      submitIcon={<Save aria-hidden="true" />}
      onCancel={onCancel}
    >
      <QuarterPicker
        label="Quarter"
        format="dash"
        value={draft.period}
        onChange={(period) => update({ period })}
        now={now}
        also={periods.map((p) => p.period)}
        marked={logged}
        latest={currentQuarter(now)}
        yearsBack={YEARS_BACK}
        currentLabel="in progress"
        error={errors.period}
        required
        className="sm:max-w-xs"
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {COST_CATEGORIES.map((c) => {
          const label = COST_CATEGORY_LABEL[c];
          const byHours = draft.byHours[c];
          const h = parseNumber(draft.hours[c]);
          const kept = keptHoursCost(draft, c, editing);
          const worked =
            byHours && h !== undefined && hourlyRate !== undefined
              ? hoursTimesRate(h, hourlyRate)
              : null;
          const hoursHint =
            kept !== undefined
              ? `= ${money(kept)}, as saved for these hours`
              : worked !== null
                ? `= ${money(worked)} at ${money(hourlyRate as number)} an hour`
                : HINT[c];
          return (
            <div key={c} className="flex min-w-0 flex-col gap-1.5" data-category={c}>
              {byHours ? (
                <Field
                  label={`${label} hours`}
                  hint={hoursHint}
                  error={
                    errors[`hours-${c}`] ??
                    (h !== undefined && hourlyRate === undefined && kept === undefined
                      ? "Enter the hourly rate first."
                      : undefined)
                  }
                >
                  {(props) => (
                    <Input
                      {...props}
                      inputMode="decimal"
                      value={draft.hours[c]}
                      onChange={(e) => setCategory("hours", c, e.target.value)}
                      className="font-data"
                    />
                  )}
                </Field>
              ) : (
                <Field label={label} hint={HINT[c]} error={errors[c]}>
                  {(props) => (
                    <div className="relative">
                      <span
                        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-sub"
                        aria-hidden="true"
                      >
                        $
                      </span>
                      <Input
                        {...props}
                        inputMode="decimal"
                        value={draft.amounts[c]}
                        onChange={(e) => setCategory("amounts", c, e.target.value)}
                        className="pl-6 font-data"
                      />
                    </div>
                  )}
                </Field>
              )}
              {/* Named for what it does next, so no aria-pressed: "pressed"
                  beside a name that flips would read the wrong way round. */}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-start"
                aria-label={
                  byHours ? `Enter ${label} as an amount` : `Work out ${label} as hours × rate`
                }
                onClick={() => setCategory("byHours", c, !byHours)}
              >
                {byHours ? "Enter an amount" : "Hours × rate"}
              </Button>
            </div>
          );
        })}
      </div>
      <Field label="Note (optional)" hint="Scope, sources of the estimates" error={errors.note}>
        {(props) => (
          <Textarea
            {...props}
            rows={2}
            value={draft.note}
            onChange={(e) => update({ note: e.target.value })}
            className="text-sm"
          />
        )}
      </Field>
    </ItemForm>
  );
}
