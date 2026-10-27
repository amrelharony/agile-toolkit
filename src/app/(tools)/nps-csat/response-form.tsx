"use client";

import { useEffect, useId, useRef } from "react";
import { Check, Plus } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { ScalePicker, type ScaleStep } from "@/components/shared/scale-picker";
import { isValidScore, type SurveyKind } from "@/lib/nps/score";
import { NPS_TAG_LIMIT, NPS_TAG_MAX_LENGTH } from "@/lib/stores/workspace-types";
import {
  RESPONDENT_MAX,
  VERBATIM_MAX,
  emptyResponse,
  validateResponse,
  type ResponseDraft,
  type ResponseField,
  type ResponseValues,
} from "./form";

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** 0–10, each named by the group it counts in (lib/nps npsCategory). */
export const NPS_STEPS: readonly ScaleStep[] = range(0, 10).map((value) => ({
  value,
  meaning: value >= 9 ? "Promoter" : value >= 7 ? "Passive" : "Detractor",
}));

/** 1–5, each named by how it counts (lib/nps csatCategory: 4–5 satisfied). */
export const CSAT_STEPS: readonly ScaleStep[] = range(1, 5).map((value) => ({
  value,
  meaning: value >= 4 ? "Satisfied" : value === 3 ? "Neutral" : "Dissatisfied",
}));

const KINDS: { value: SurveyKind; label: string; description: string }[] = [
  { value: "nps", label: "NPS (0–10)", description: "How likely are you to recommend us?" },
  { value: "csat", label: "CSAT (1–5)", description: "How satisfied were you?" },
];

/** The form's first control: the survey's checked (or first) option, else a field. */
const FIRST_CONTROL = '[role="radio"][tabindex="0"], input, textarea';

/**
 * One survey answer, added by hand or edited in place. The survey and the
 * score start unset; switching the survey clears a score that isn't on the
 * new scale instead of squeezing it in. A legacy score (`keepScore`) is
 * offered only on the survey it was given for (`keepKind`). Tags are
 * comma-separated theme words ("checkout, pricing"), checked before saving
 * so none is cut.
 */
export function ResponseForm({
  initial,
  today,
  onSave,
  onCancel,
  submitLabel,
  keepScore,
  keepKind,
  autoFocus = false,
}: {
  initial: ResponseDraft;
  today: string;
  onSave: (values: ResponseValues, draft: ResponseDraft) => void;
  onCancel?: () => void;
  submitLabel: string;
  /** An edited row's stored score, kept as it is when not changed (a fraction from before Phase 8). */
  keepScore?: number;
  /** The survey `keepScore` was given for: on the other one it isn't offered. */
  keepKind?: SurveyKind;
  /**
   * Opened by a click (Edit): focus the first control, as the row it
   * replaces took the focused button with it. Never on page load.
   */
  autoFocus?: boolean;
}) {
  // An add form starts its next answer on the survey and day just saved
  // (entering one survey's answers), with the score unset again.
  const last = useRef({ date: initial.date, kind: initial.kind });
  const form = useItemForm<ResponseDraft, ResponseValues, ResponseField>({
    initial: onCancel ? initial : () => emptyResponse(last.current.date, last.current.kind),
    validate: (d) => validateResponse(d, today, { keepScore, keepKind }),
    onSave: (values, d) => {
      last.current = { date: d.date, kind: d.kind };
      onSave(values, d);
    },
    resetOnSave: !onCancel,
  });
  const { draft, update, errors, formRef } = form;
  useEffect(() => {
    if (autoFocus) formRef.current?.querySelector<HTMLElement>(FIRST_CONTROL)?.focus();
  }, [autoFocus, formRef]);
  const kindErrorId = useId();
  const steps = draft.kind === "csat" ? CSAT_STEPS : NPS_STEPS;
  // The stored score stays on offer only on its own survey's scale.
  const custom = draft.kind !== null && draft.kind === keepKind ? keepScore : undefined;
  return (
    <ItemForm
      form={form}
      submitLabel={submitLabel}
      submitIcon={
        onCancel ? (
          <Check className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Plus className="h-4 w-4" aria-hidden="true" />
        )
      }
      onCancel={onCancel}
    >
      <div className="flex flex-wrap items-start gap-4">
        <div
          className="flex min-w-0 flex-col gap-1.5"
          data-scale-invalid={errors.kind ? "true" : undefined}
        >
          <span className="text-sm text-text" aria-hidden="true">
            Survey<span className="ml-0.5 text-danger">*</span>
          </span>
          <ToggleGroup
            label="Survey"
            options={KINDS}
            value={draft.kind}
            onValueChange={(kind) =>
              update({
                kind,
                score: draft.score !== null && isValidScore(kind, draft.score) ? draft.score : null,
              })
            }
            aria-describedby={errors.kind ? kindErrorId : undefined}
          />
          {errors.kind && (
            <p id={kindErrorId} className="text-xs text-danger" role="alert">
              {errors.kind}
            </p>
          )}
        </div>
        <Field label="Day" error={errors.date} required className="w-44">
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
      </div>
      {draft.kind ? (
        <ScalePicker
          label="Score"
          steps={steps}
          value={draft.score}
          custom={custom}
          onValueChange={(score) => update({ score })}
          hint={
            draft.kind === "nps"
              ? "9–10 promoter, 7–8 passive, 0–6 detractor."
              : "4–5 satisfied, 3 neutral, 1–2 dissatisfied."
          }
          error={errors.score}
          size="sm"
          optionsClassName={draft.kind === "nps" ? "grid grid-cols-6 sm:inline-flex" : undefined}
        />
      ) : (
        <p className="text-xs text-sub" data-scale-invalid={errors.score ? "true" : undefined}>
          Pick the survey to see its scale.
          {errors.score && (
            <span className="ml-1 text-danger" role="alert">
              {errors.score}
            </span>
          )}
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[14rem_minmax(0,1fr)]">
        <Field label="Respondent" hint="A name or email (optional)" error={errors.respondent}>
          {(props) => (
            <Input
              {...props}
              value={draft.respondent}
              maxLength={RESPONDENT_MAX}
              onChange={(e) => update({ respondent: e.target.value })}
            />
          )}
        </Field>
        <Field
          label="Tags"
          hint={`Themes, comma-separated: checkout, pricing (up to ${NPS_TAG_LIMIT}, ${NPS_TAG_MAX_LENGTH} characters each).`}
          error={errors.tags}
        >
          {(props) => (
            <Input
              {...props}
              value={draft.tags}
              onChange={(e) => update({ tags: e.target.value })}
            />
          )}
        </Field>
      </div>
      <Field label="Verbatim" error={errors.verbatim}>
        {(props) => (
          <Textarea
            {...props}
            rows={2}
            value={draft.verbatim}
            maxLength={VERBATIM_MAX}
            onChange={(e) => update({ verbatim: e.target.value })}
            placeholder="What the customer wrote (optional)"
            className="resize-none"
          />
        )}
      </Field>
    </ItemForm>
  );
}
