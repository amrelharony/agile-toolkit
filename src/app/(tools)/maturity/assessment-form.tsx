"use client";

import { Copy, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { ScalePicker } from "@/components/shared/scale-picker";
import { MATURITY_DIMENSIONS } from "@/lib/constants/maturity-model";
import type { Validation } from "@/lib/utils/form";
import {
  NOTE_MAX,
  assessedAtError,
  cleanScores,
  levelOf,
  scoredCount,
} from "@/lib/maturity/assessment";

export interface SaveDraft {
  /** "YYYY-MM-DD": today unless backdated. */
  assessedAt: string;
  note: string;
}

export interface SaveValues {
  scores: Record<string, number>;
  assessedAt: string;
  note?: string;
}

/** A dimension id, or one of the form's own fields. */
export type SaveField = string;

/**
 * Check an assessment before it is saved: every dimension scored (each
 * unscored one gets its own message, and the first takes focus), a day
 * that exists and isn't after today, and a note of a sane length.
 */
export function validateAssessment(
  scores: Readonly<Record<string, unknown>>,
  d: SaveDraft,
  today: string
): Validation<SaveValues, SaveField> {
  const errors: Record<string, string> = {};
  for (const dim of MATURITY_DIMENSIONS) {
    if (levelOf(scores[dim.id]) === null) errors[dim.id] = `Score ${dim.name} before saving.`;
  }
  const dateError = assessedAtError(d.assessedAt, today);
  if (dateError) errors.assessedAt = dateError;
  if (d.note.trim().length > NOTE_MAX) errors.note = `Keep it to ${NOTE_MAX} characters.`;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const note = d.note.trim();
  return {
    ok: true,
    values: { scores: cleanScores(scores), assessedAt: d.assessedAt, ...(note ? { note } : {}) },
  };
}

/**
 * The draft: a level picker per dimension (Not scored until picked; Clear
 * takes a score back), then the day it was taken and a note. Each pick is
 * kept in the draft right away, so a team can score across a session; the
 * assessment counts only once it is saved.
 */
export function AssessmentForm({
  scores,
  today,
  onScore,
  onSave,
  onStartFromLast,
  title,
}: {
  scores: Readonly<Record<string, number>>;
  today: string;
  onScore: (dimensionId: string, level: number | null) => void;
  onSave: (values: SaveValues) => void;
  /** Copy the latest saved scores into the draft; absent with nothing saved. */
  onStartFromLast?: () => void;
  title: string;
}) {
  const form = useItemForm<SaveDraft, SaveValues, SaveField>({
    initial: () => ({ assessedAt: today, note: "" }),
    validate: (d) => validateAssessment(scores, d, today),
    onSave,
  });
  const { draft, update, errors } = form;
  const scored = scoredCount(scores);
  return (
    <ItemForm
      form={form}
      submitLabel="Save assessment"
      submitIcon={<Save className="h-4 w-4" aria-hidden="true" />}
      footer={
        onStartFromLast && (
          <Button type="button" variant="outline" onClick={onStartFromLast} className="gap-1">
            <Copy className="h-4 w-4" aria-hidden="true" />
            Start from the last assessment
          </Button>
        )
      }
    >
      <p className="text-sm text-sub" aria-live="polite">
        {title}: {scored} of {MATURITY_DIMENSIONS.length} dimensions scored.
      </p>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {MATURITY_DIMENSIONS.map((dim) => {
          const level = levelOf(scores[dim.id]);
          const chosen = level === null ? null : dim.levels.find((l) => l.level === level);
          return (
            <div key={dim.id} className="min-w-0 space-y-1.5">
              <ScalePicker
                label={dim.name}
                steps={dim.levels.map((l) => ({
                  value: l.level,
                  name: l.label,
                  meaning: l.description,
                }))}
                value={level}
                onValueChange={(v) => onScore(dim.id, v)}
                onClear={() => onScore(dim.id, null)}
                error={errors[dim.id]}
                size="sm"
                optionsClassName="grid grid-cols-2 sm:inline-flex"
              />
              <p className="text-xs leading-relaxed text-sub">
                {chosen ? chosen.description : "Not scored"}
              </p>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <Field
          label="Taken on"
          error={errors.assessedAt}
          required
          hint="Backdate it to the day you scored it."
        >
          {(props) => (
            <Input
              {...props}
              type="date"
              max={today}
              value={draft.assessedAt}
              onChange={(e) => update({ assessedAt: e.target.value })}
            />
          )}
        </Field>
        <Field label="Note" error={errors.note}>
          {(props) => (
            <Input
              {...props}
              value={draft.note}
              maxLength={NOTE_MAX}
              onChange={(e) => update({ note: e.target.value })}
              placeholder="Optional: who took part, what you agreed"
            />
          )}
        </Field>
      </div>
    </ItemForm>
  );
}
