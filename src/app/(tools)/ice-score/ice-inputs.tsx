"use client";

import { Plus } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ItemForm, useItemForm, type ItemFormState } from "@/components/shared/item-form";
import { ScalePicker, offScale, toNumber, type ScaleStep } from "@/components/shared/scale-picker";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";
import type { Validation } from "@/lib/utils/form";

/** A 1–10 scale with what each value means (the option's tooltip). */
const scale = (meanings: readonly string[]): readonly ScaleStep[] =>
  meanings.map((meaning, i) => ({ value: i + 1, meaning }));

/** How much the idea moves the goal if it works. */
export const IMPACT_STEPS = scale([
  "Barely noticeable",
  "Very small",
  "Small",
  "Modest",
  "A clear improvement",
  "Solid",
  "Big",
  "Very big",
  "Major",
  "Changes the game for the goal",
]);

/** How sure the team is about the impact and the ease. */
export const CONFIDENCE_STEPS = scale([
  "A hunch",
  "A hunch the team shares",
  "A few anecdotes",
  "Some user feedback",
  "Data points or interviews",
  "Several sources agree",
  "Market or usage data",
  "A tested prototype",
  "Experiment results",
  "Proven in an earlier launch",
]);

/** How little effort it takes: 10 is under a day, 1 is months across teams. */
export const EASE_STEPS = scale([
  "Months of work across teams",
  "About a quarter",
  "More than a month",
  "About a month",
  "Two to three weeks",
  "About two weeks",
  "About a week",
  "A few days",
  "A day or two",
  "Under a day",
]);

export const ICE_SCALES = {
  impact: IMPACT_STEPS,
  confidence: CONFIDENCE_STEPS,
  ease: EASE_STEPS,
} as const;

export type IceKey = keyof typeof ICE_SCALES;
export const ICE_KEYS: readonly IceKey[] = ["impact", "confidence", "ease"];

const LABEL: Record<IceKey, string> = {
  impact: "Impact",
  confidence: "Confidence",
  ease: "Ease",
};

const HINT: Record<IceKey, string> = {
  impact: "1 barely noticeable · 5 a clear improvement · 10 changes the game for the goal.",
  confidence: "1 a hunch · 5 data points or interviews · 10 proven in an earlier launch.",
  ease: "1 months across teams · 5 two to three weeks · 10 under a day.",
};

const MISSING: Record<IceKey, string> = {
  impact: "Pick an impact score.",
  confidence: "Pick a confidence score.",
  ease: "Pick an ease score.",
};

export interface IceDraft {
  title: string;
  impact: number | null;
  confidence: number | null;
  ease: number | null;
}

export type IceValues = { title: string } & Record<IceKey, number>;
export type IceField = keyof IceDraft;

export const EMPTY_ICE_DRAFT: IceDraft = { title: "", impact: null, confidence: null, ease: null };

type Fields = NonNullable<PrioritizationItem["fields"]>;

/** A draft from a stored row (its scores may be off the 1–10 steps). */
export function iceDraftFrom(row: Pick<PrioritizationItem, "title" | "fields">): IceDraft {
  const f = row.fields;
  return {
    title: row.title,
    impact: toNumber(f?.impact) ?? null,
    confidence: toNumber(f?.confidence) ?? null,
    ease: toNumber(f?.ease) ?? null,
  };
}

/**
 * Check a draft. A missing score is an error, never a silent 5; a stored
 * off-scale value (a 6.5 typed before the scales) is kept as it is, inside
 * the 1–10 range the score function clamps to anyway.
 */
export function validateIce(d: IceDraft): Validation<IceValues, IceField> {
  const errors: Partial<Record<IceField, string>> = {};
  const title = d.title.trim();
  if (!title) errors.title = "Enter a title.";
  for (const key of ICE_KEYS) {
    const v = d[key];
    if (v === null) errors[key] = MISSING[key];
    else if (!Number.isFinite(v) || v < 1 || v > 10)
      errors[key] = `${LABEL[key]} runs from 1 to 10.`;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: {
      title,
      impact: d.impact as number,
      confidence: d.confidence as number,
      ease: d.ease as number,
    },
  };
}

/** `fields` with the new scores, keeping any other keys the row carries. */
export function withIceValues(fields: Fields | undefined, v: IceValues): Fields {
  return { ...fields, impact: v.impact, confidence: v.confidence, ease: v.ease };
}

export function sameIceValues(row: PrioritizationItem, v: IceValues): boolean {
  return (
    row.title === v.title &&
    toNumber(row.fields?.impact) === v.impact &&
    toNumber(row.fields?.confidence) === v.confidence &&
    toNumber(row.fields?.ease) === v.ease
  );
}

/** The title and three scales, shared by the add form and the row editor. */
function IceFields({
  draft,
  update,
  errors,
  custom,
}: {
  draft: IceDraft;
  update: (patch: Partial<IceDraft>) => void;
  errors: Partial<Record<IceField, string>>;
  custom?: Partial<Record<IceKey, number | null>>;
}) {
  return (
    <>
      <Field label="Idea or experiment" error={errors.title} required>
        {(props) => (
          <Input
            {...props}
            value={draft.title}
            onChange={(e) => update({ title: e.target.value })}
            placeholder="e.g. Onboarding email with a setup checklist"
          />
        )}
      </Field>
      {/* Ten options fit one row in a column only on wide screens; stack below. */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {ICE_KEYS.map((key) => (
          <ScalePicker
            key={key}
            label={LABEL[key]}
            // Compact options keep all ten on one row from 640 px; touch
            // targets grow on phones, where two rows of five read cleanly.
            size="sm"
            optionsClassName="grid grid-cols-5 sm:inline-flex"
            steps={ICE_SCALES[key]}
            value={draft[key]}
            custom={custom?.[key]}
            onValueChange={(v) => update({ [key]: v } as Partial<IceDraft>)}
            onClear={() => update({ [key]: null } as Partial<IceDraft>)}
            hint={HINT[key]}
            error={errors[key]}
          />
        ))}
      </div>
    </>
  );
}

/** The add form's state; the client owns it so "Import from backlog" can fill the title. */
export function useIceAddForm(
  onAdd: (values: IceValues) => void
): ItemFormState<IceDraft, IceField> {
  return useItemForm<IceDraft, IceValues, IceField>({
    initial: EMPTY_ICE_DRAFT,
    validate: validateIce,
    onSave: onAdd,
  });
}

/** "Add & score": nothing is saved until the title and all three scores are set. */
export function IceAddForm({
  form,
  footer,
}: {
  form: ItemFormState<IceDraft, IceField>;
  footer?: ReactNode;
}) {
  return (
    <ItemForm
      form={form}
      submitLabel="Add & score"
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
      footer={footer}
    >
      <IceFields draft={form.draft} update={form.update} errors={form.errors} />
    </ItemForm>
  );
}

/** Edit a ranked idea in place. Enter saves, Escape cancels. */
export function IceRowEditor({
  row,
  onSave,
  onCancel,
}: {
  row: PrioritizationItem;
  onSave: (values: IceValues) => void;
  onCancel: () => void;
}) {
  const start = iceDraftFrom(row);
  const form = useItemForm<IceDraft, IceValues, IceField>({
    initial: start,
    validate: validateIce,
    onSave,
    resetOnSave: false,
  });
  const { formRef } = form;
  // Open on the title, so the keyboard user lands where they were heading.
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("input")?.focus();
  }, [formRef]);
  const custom = {
    impact: offScale(IMPACT_STEPS, start.impact),
    confidence: offScale(CONFIDENCE_STEPS, start.confidence),
    ease: offScale(EASE_STEPS, start.ease),
  };
  return (
    <ItemForm form={form} submitLabel="Save" onCancel={onCancel}>
      <IceFields draft={form.draft} update={form.update} errors={form.errors} custom={custom} />
    </ItemForm>
  );
}
