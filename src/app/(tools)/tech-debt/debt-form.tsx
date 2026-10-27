"use client";

import { Plus } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { ScalePicker } from "@/components/shared/scale-picker";
import { toScale } from "@/lib/risks/model";
import { isIsoDate } from "@/lib/sprints/calendar";
import type { TechDebtItem } from "@/lib/stores/workspace-types";
import {
  DEBT_AREA_MAX,
  DEBT_TEXT_MAX,
  DEBT_TITLE_MAX,
  INTEREST_RATE_MAX,
} from "@/lib/tech-debt/model";
import { parseNumber, type FormErrors, type Validation } from "@/lib/utils/form";
import { DEBT_EFFORT_HINT, DEBT_EFFORT_STEPS, DEBT_IMPACT_HINT, DEBT_IMPACT_STEPS } from "./scales";

/** What the "New debt" form holds while it is filled in. Ratings start unset. */
export interface DebtDraft {
  title: string;
  area: string;
  impact: number | null;
  effort: number | null;
  /** As typed; "" is "not estimated". */
  interestRate: string;
  /** "YYYY-MM-DD": today unless the debt was taken on earlier. */
  raisedAt: string;
  description: string;
}

export type DebtField = keyof DebtDraft;

/** An item ready to save: rated, titled, dated; the optional fields only when given. */
export type NewDebt = Pick<TechDebtItem, "title" | "impact" | "effort" | "raisedAt"> &
  Partial<Pick<TechDebtItem, "area" | "interestRate" | "description">>;

export function emptyDebtDraft(today: string): DebtDraft {
  return {
    title: "",
    area: "",
    impact: null,
    effort: null,
    interestRate: "",
    raisedAt: today,
    description: "",
  };
}

/** One line: pasted line breaks become spaces. */
const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " ").trim();

/** Why a typed day can't be the day debt was raised, or null. */
export function raisedDayError(day: string, today: string): string | null {
  if (!day.trim()) return "Pick the day it was raised.";
  if (!isIsoDate(day)) return "Pick a day.";
  if (day > today) return "Pick today or an earlier day.";
  return null;
}

/** Why a typed day can't be the day an item raised on `raised` was paid down, or null. */
export function resolvedDayError(day: string, raised: string, today: string): string | null {
  if (!isIsoDate(day)) return "Pick the day it was paid down.";
  if (day > today) return "Pick today or an earlier day.";
  const from = raised.slice(0, 10);
  if (isIsoDate(from) && day < from) return "Pick a day on or after the day it was raised.";
  return null;
}

/**
 * The interest per sprint as typed: undefined when blank ("not
 * estimated", never written as 0), or why it can't be saved.
 */
export function parseInterest(raw: string): { value?: number; error?: string } {
  const n = parseNumber(raw);
  if (n === undefined) return {};
  if (!Number.isFinite(n)) return { error: "Enter a number, or leave it empty." };
  if (n < 0) return { error: "It can't be negative." };
  if (n > INTEREST_RATE_MAX) return { error: `Keep it to ${INTEREST_RATE_MAX} or less.` };
  return { value: n };
}

/**
 * Check a draft. An item needs a title and both ratings: nothing is saved
 * at a default 3 × 3 with an interest of 1 (the old page saved a blank
 * one like that the moment "New Debt" was pressed). The interest is
 * optional and stays "not estimated" when blank; the raised day can be
 * backdated, never later than today.
 */
export function validateDebtDraft(d: DebtDraft, today: string): Validation<NewDebt, DebtField> {
  const errors: FormErrors<DebtField> = {};
  const title = oneLine(d.title);
  const area = d.area.trim();
  const description = d.description.trim();
  const impact = d.impact === null ? null : toScale(d.impact);
  const effort = d.effort === null ? null : toScale(d.effort);
  const interest = parseInterest(d.interestRate);
  if (!title) errors.title = "Name the debt.";
  else if (title.length > DEBT_TITLE_MAX) errors.title = `Keep it to ${DEBT_TITLE_MAX} characters.`;
  if (area.length > DEBT_AREA_MAX) errors.area = `Keep the area to ${DEBT_AREA_MAX} characters.`;
  if (impact === null) errors.impact = "Rate how much it slows the team.";
  if (effort === null) errors.effort = "Rate the effort to pay it down.";
  if (interest.error) errors.interestRate = interest.error;
  const raised = raisedDayError(d.raisedAt, today);
  if (raised) errors.raisedAt = raised;
  if (description.length > DEBT_TEXT_MAX)
    errors.description = `Keep it to ${DEBT_TEXT_MAX} characters.`;
  if (Object.keys(errors).length > 0 || impact === null || effort === null) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    values: {
      title,
      impact,
      effort,
      raisedAt: d.raisedAt,
      ...(area ? { area } : {}),
      ...(interest.value !== undefined ? { interestRate: interest.value } : {}),
      ...(description ? { description } : {}),
    },
  };
}

/** The item a valid form saves, open, under `id`. */
export function newDebt(values: NewDebt, id: string): TechDebtItem {
  return { id, ...values };
}

/**
 * "New debt": what it is, where it lives, how much it slows the team and
 * how much work paying it down is (both rated, no default), the interest
 * it gains each sprint it is left (optional: "not estimated" when blank),
 * and the day it was raised (backdatable). Nothing is saved until it is
 * valid; Enter in a field saves, and the first invalid field gets focus.
 */
export function DebtForm({
  today,
  onSave,
  onCancel,
}: {
  today: string;
  onSave: (values: NewDebt) => void;
  onCancel?: () => void;
}) {
  const form = useItemForm<DebtDraft, NewDebt, DebtField>({
    initial: () => emptyDebtDraft(today),
    validate: (d) => validateDebtDraft(d, today),
    onSave,
  });
  const { draft, update, errors } = form;

  return (
    <ItemForm
      form={form}
      submitLabel="Add debt"
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
      onCancel={onCancel}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <Field label="Debt" error={errors.title} required>
          {(props) => (
            <Input
              {...props}
              value={draft.title}
              maxLength={DEBT_TITLE_MAX}
              onChange={(e) => update({ title: e.target.value })}
              placeholder="e.g. Hand-rolled date maths in billing"
            />
          )}
        </Field>
        <Field label="Area" error={errors.area} hint="Optional: groups the hotspots.">
          {(props) => (
            <Input
              {...props}
              value={draft.area}
              maxLength={DEBT_AREA_MAX}
              onChange={(e) => update({ area: e.target.value })}
              placeholder="e.g. billing"
            />
          )}
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ScalePicker
          label="Impact"
          size="sm"
          steps={DEBT_IMPACT_STEPS}
          value={draft.impact}
          onValueChange={(impact) => update({ impact })}
          onClear={() => update({ impact: null })}
          hint={DEBT_IMPACT_HINT}
          error={errors.impact}
        />
        <ScalePicker
          label="Effort"
          size="sm"
          steps={DEBT_EFFORT_STEPS}
          value={draft.effort}
          onValueChange={(effort) => update({ effort })}
          onClear={() => update({ effort: null })}
          hint={DEBT_EFFORT_HINT}
          error={errors.effort}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          label="Interest per sprint"
          error={errors.interestRate}
          hint="Score points it gains each sprint it's left. Optional: blank is “not estimated”."
        >
          {(props) => (
            <Input
              {...props}
              type="number"
              inputMode="decimal"
              min={0}
              max={INTEREST_RATE_MAX}
              step={0.5}
              value={draft.interestRate}
              onChange={(e) => update({ interestRate: e.target.value })}
            />
          )}
        </Field>
        <Field label="Raised on" error={errors.raisedAt} hint="Backdate it if it's older.">
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
      </div>
      <Field label="Description" error={errors.description} hint="Optional.">
        {(props) => (
          <Textarea
            {...props}
            rows={2}
            maxLength={DEBT_TEXT_MAX}
            value={draft.description}
            onChange={(e) => update({ description: e.target.value })}
            placeholder="What it costs the team, and what paying it down takes"
          />
        )}
      </Field>
    </ItemForm>
  );
}
