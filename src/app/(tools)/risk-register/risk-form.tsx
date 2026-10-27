"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { ScalePicker } from "@/components/shared/scale-picker";
import { PersonPicker } from "@/components/team/person-picker";
import { addDays } from "@/lib/impediments/model";
import {
  RISK_OWNER_MAX,
  RISK_TEXT_MAX,
  RISK_TITLE_MAX,
  riskLevel,
  toScale,
} from "@/lib/risks/model";
import { isIsoDate } from "@/lib/sprints/calendar";
import { findRosterMember } from "@/lib/team/names";
import type { Risk, RiskScale, TeamMember } from "@/lib/stores/workspace-types";
import type { FormErrors, Validation } from "@/lib/utils/form";
import { IMPACT_HINT, IMPACT_STEPS, LIKELIHOOD_HINT, LIKELIHOOD_STEPS } from "./scales";

/** What the "New risk" form holds while it is filled in. Ratings start unset. */
export interface RiskDraft {
  title: string;
  probability: number | null;
  impact: number | null;
  owner: string;
  /** "YYYY-MM-DD": today unless the risk was spotted earlier. */
  raisedAt: string;
  mitigation: string;
  /** "YYYY-MM-DD", or "" for none. */
  mitigationDueAt: string;
  residualProbability: number | null;
  residualImpact: number | null;
}

export type RiskField = keyof RiskDraft;

/** A risk ready to save: rated, titled, dated; the optional fields only when given. */
export type NewRisk = Pick<Risk, "title" | "probability" | "impact" | "raisedAt"> &
  Partial<
    Pick<
      Risk,
      "owner" | "mitigation" | "mitigationDueAt" | "residualProbability" | "residualImpact"
    >
  >;

export function emptyRiskDraft(today: string): RiskDraft {
  return {
    title: "",
    probability: null,
    impact: null,
    owner: "",
    raisedAt: today,
    mitigation: "",
    mitigationDueAt: "",
    residualProbability: null,
    residualImpact: null,
  };
}

/** One line: pasted line breaks become spaces. */
const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " ").trim();

/** Why a typed day can't be the day it was raised, or null. */
export function raisedDayError(day: string, today: string): string | null {
  if (!day.trim()) return "Pick the day it was raised.";
  if (!isIsoDate(day)) return "Pick a day.";
  if (day > today) return "Pick today or an earlier day.";
  return null;
}

/**
 * Why a typed day can't be the day a risk raised on `raised` was closed,
 * or null: a day, not after today, not before it was raised (the agent's
 * set_status refuses the same).
 */
export function closedDayError(day: string, raised: string, today: string): string | null {
  if (!isIsoDate(day)) return "Pick the day it was closed.";
  if (day > today) return "Pick today or an earlier day.";
  const from = raised.slice(0, 10);
  if (isIsoDate(from) && day < from) return "Pick a day on or after the day it was raised.";
  return null;
}

/** Why a typed due day can't be saved for a risk raised on `raised`, or null ("" clears it). */
export function dueDayError(day: string, raised: string): string | null {
  if (!day.trim()) return null;
  if (!isIsoDate(day)) return "Pick a day, or leave it empty.";
  if (isIsoDate(raised) && day < raised) return "Pick a day on or after the day it was raised.";
  return null;
}

/**
 * Check a draft. A risk needs a title and both ratings: nothing is saved
 * at a default 3 × 3 (the old page saved a blank one at 9 the moment "New
 * Risk" was pressed). The raised day can be backdated, never later than
 * today; the due day isn't before it. The rating after mitigation is both
 * values or neither. A rating after mitigation that is higher than the
 * current one is allowed (a plan can make a risk likelier for a while):
 * the form warns (residualWarning), it doesn't refuse.
 */
export function validateRiskDraft(
  d: RiskDraft,
  today: string,
  roster: readonly TeamMember[] = []
): Validation<NewRisk, RiskField> {
  const errors: FormErrors<RiskField> = {};
  const title = oneLine(d.title);
  const owner = d.owner.trim();
  const mitigation = d.mitigation.trim();
  const probability = d.probability === null ? null : toScale(d.probability);
  const impact = d.impact === null ? null : toScale(d.impact);
  if (!title) errors.title = "Name the risk.";
  else if (title.length > RISK_TITLE_MAX) errors.title = `Keep it to ${RISK_TITLE_MAX} characters.`;
  if (probability === null) errors.probability = "Rate how likely it is.";
  if (impact === null) errors.impact = "Rate the impact.";
  if (owner.length > RISK_OWNER_MAX)
    errors.owner = `Keep the name to ${RISK_OWNER_MAX} characters.`;
  const raised = raisedDayError(d.raisedAt, today);
  if (raised) errors.raisedAt = raised;
  if (mitigation.length > RISK_TEXT_MAX)
    errors.mitigation = `Keep the plan to ${RISK_TEXT_MAX} characters.`;
  const due = dueDayError(d.mitigationDueAt, d.raisedAt);
  if (due) errors.mitigationDueAt = due;
  const rp = d.residualProbability === null ? null : toScale(d.residualProbability);
  const ri = d.residualImpact === null ? null : toScale(d.residualImpact);
  if (rp !== null && ri === null)
    errors.residualImpact = "Rate the impact after mitigation too, or clear both.";
  if (ri !== null && rp === null)
    errors.residualProbability = "Rate the likelihood after mitigation too, or clear both.";
  if (Object.keys(errors).length > 0 || probability === null || impact === null) {
    return { ok: false, errors };
  }
  const named = owner ? (findRosterMember(roster, owner)?.name ?? owner) : "";
  return {
    ok: true,
    values: {
      title,
      probability,
      impact,
      raisedAt: d.raisedAt,
      ...(named ? { owner: named } : {}),
      ...(mitigation ? { mitigation } : {}),
      ...(d.mitigationDueAt ? { mitigationDueAt: d.mitigationDueAt } : {}),
      ...(rp !== null && ri !== null
        ? { residualProbability: rp as RiskScale, residualImpact: ri as RiskScale }
        : {}),
    },
  };
}

/** The risk a valid form saves: open, under `id`. */
export function newRisk(values: NewRisk, id: string): Risk {
  return { id, status: "open", ...values };
}

/** "Scores 12 (high)" once both are rated; null before. */
export function scorePreview(p: number | null, i: number | null): string | null {
  const a = p === null ? null : toScale(p);
  const b = i === null ? null : toScale(i);
  if (a === null || b === null) return null;
  return `Scores ${a * b} (${riskLevel(a * b)})`;
}

/** The warning when the rating after mitigation scores higher than the current one, or null. */
export function residualWarning(
  p: number | null,
  i: number | null,
  rp: number | null,
  ri: number | null
): string | null {
  if (p === null || i === null || rp === null || ri === null) return null;
  const now = (toScale(p) ?? 1) * (toScale(i) ?? 1);
  const after = (toScale(rp) ?? 1) * (toScale(ri) ?? 1);
  return after > now
    ? `After mitigation it scores ${after}, higher than ${now} now. Saved as it is; check the ratings.`
    : null;
}

/**
 * "New risk": the risk, how likely and how bad (both rated, no default),
 * who owns it, the day it was raised (backdatable), the plan and its due
 * day, and optionally the rating once the plan has worked. Nothing is
 * saved until it is valid; Enter in a field saves, and the first invalid
 * field gets focus. `typicalDays` (the register's median time to
 * mitigate, once there is one) offers a due day.
 */
export function RiskForm({
  today,
  roster,
  typicalDays,
  onSave,
  onCancel,
}: {
  today: string;
  roster: readonly TeamMember[];
  typicalDays: number | null;
  onSave: (values: NewRisk) => void;
  onCancel?: () => void;
}) {
  const form = useItemForm<RiskDraft, NewRisk, RiskField>({
    initial: () => emptyRiskDraft(today),
    validate: (d) => validateRiskDraft(d, today, roster),
    onSave,
  });
  const { draft, update, errors } = form;
  const preview = scorePreview(draft.probability, draft.impact);
  const warning = residualWarning(
    draft.probability,
    draft.impact,
    draft.residualProbability,
    draft.residualImpact
  );
  const suggested =
    typicalDays !== null && isIsoDate(draft.raisedAt) ? addDays(draft.raisedAt, typicalDays) : null;

  return (
    <ItemForm
      form={form}
      submitLabel="Add risk"
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
      onCancel={onCancel}
    >
      <Field label="Risk" error={errors.title} required>
        {(props) => (
          <Input
            {...props}
            value={draft.title}
            maxLength={RISK_TITLE_MAX}
            onChange={(e) => update({ title: e.target.value })}
            placeholder="e.g. The payment provider changes its API mid-sprint"
          />
        )}
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ScalePicker
          label="Likelihood"
          size="sm"
          steps={LIKELIHOOD_STEPS}
          value={draft.probability}
          onValueChange={(probability) => update({ probability })}
          onClear={() => update({ probability: null })}
          hint={LIKELIHOOD_HINT}
          error={errors.probability}
        />
        <ScalePicker
          label="Impact"
          size="sm"
          steps={IMPACT_STEPS}
          value={draft.impact}
          onValueChange={(impact) => update({ impact })}
          onClear={() => update({ impact: null })}
          hint={IMPACT_HINT}
          error={errors.impact}
        />
      </div>
      <p className="text-sm text-sub" aria-live="polite">
        {preview ?? "Not scored yet: rate both."}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PersonPicker
          label="Owner"
          value={draft.owner}
          onChange={(owner) => update({ owner })}
          error={errors.owner}
          placeholder="Who keeps an eye on it"
          hint="Optional."
        />
        <Field
          label="Raised on"
          error={errors.raisedAt}
          hint="Backdate it if it was spotted earlier."
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
      </div>
      <Field label="Mitigation plan" error={errors.mitigation} hint="Optional.">
        {(props) => (
          <Textarea
            {...props}
            rows={2}
            maxLength={RISK_TEXT_MAX}
            value={draft.mitigation}
            onChange={(e) => update({ mitigation: e.target.value })}
            placeholder="What the team will do to make it less likely or less bad"
          />
        )}
      </Field>
      <div className="flex flex-wrap items-end gap-3">
        <Field
          label="Mitigation due"
          error={errors.mitigationDueAt}
          hint="Optional."
          className="w-full sm:w-52"
        >
          {(props) => (
            <Input
              {...props}
              type="date"
              min={isIsoDate(draft.raisedAt) ? draft.raisedAt : undefined}
              value={draft.mitigationDueAt}
              onChange={(e) => update({ mitigationDueAt: e.target.value })}
            />
          )}
        </Field>
        {suggested && !draft.mitigationDueAt && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mb-6"
            onClick={() => update({ mitigationDueAt: suggested })}
          >
            Use {suggested} (risks here take {typicalDays} {typicalDays === 1 ? "day" : "days"} to
            close)
          </Button>
        )}
      </div>
      <fieldset className="space-y-2 rounded-md border border-border p-3">
        <legend className="px-1 text-sm text-text">After mitigation (optional)</legend>
        <p className="text-xs text-sub">
          How likely and how bad once the plan has worked. Rate both, or leave both empty.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ScalePicker
            label="Likelihood after"
            size="sm"
            steps={LIKELIHOOD_STEPS}
            value={draft.residualProbability}
            onValueChange={(residualProbability) => update({ residualProbability })}
            onClear={() => update({ residualProbability: null })}
            error={errors.residualProbability}
          />
          <ScalePicker
            label="Impact after"
            size="sm"
            steps={IMPACT_STEPS}
            value={draft.residualImpact}
            onValueChange={(residualImpact) => update({ residualImpact })}
            onClear={() => update({ residualImpact: null })}
            error={errors.residualImpact}
          />
        </div>
        {warning && (
          <p className="text-xs text-warning" role="status">
            {warning}
          </p>
        )}
      </fieldset>
    </ItemForm>
  );
}
