"use client";

import { useEffect } from "react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { MethodInputs } from "@/components/prioritization/method-inputs";
import {
  draftFrom,
  validateMethodDraft,
  withClears,
  type MethodDraft,
  type MethodInputsSlotProps,
} from "@/components/prioritization/method-tool";
import { KANO, type Values } from "@/lib/prioritization/methods";
import {
  KANO_CATEGORIES,
  KANO_CATEGORY_LABEL,
  KANO_CLASSES,
  KANO_COUNT_KEYS,
  type KanoCategory,
} from "@/lib/prioritization/methods/kano";
import type { RankedRow } from "@/lib/prioritization/rank";
import type { Validation } from "@/lib/utils/form";
import { draftCounts, previewText } from "./model";

/** How the form takes answers: one person's pair, or counts from a survey run elsewhere. */
export type AnswerMode = "pair" | "counts";

/** The draft key holding the mode (not a method input: the row never stores it). */
export const MODE_KEY = "answerMode";

const PAIR_KEYS = ["functional", "dysfunctional"] as const;
const COUNT_KEYS = KANO_CLASSES.map((k) => KANO_COUNT_KEYS[k]);

export const modeOf = (d: Values): AnswerMode => (d[MODE_KEY] === "counts" ? "counts" : "pair");

const pickedOf = (v: unknown): KanoCategory | null =>
  typeof v === "string" && (KANO_CATEGORIES as readonly string[]).includes(v)
    ? (v as KanoCategory)
    : null;

/** Every input of the other way of answering, cleared: a switch never keeps both. */
function cleared(keys: readonly string[]): Values {
  return Object.fromEntries(keys.map((k) => [k, undefined]));
}

/**
 * Check a Kano draft as the registry does (both answers of a pair, or
 * whole counts adding up to at least one), with two page rules on top:
 * "Survey counts" with nothing typed says so under the counts, and a
 * legacy row picked by hand may be saved as it is (a rename) until
 * answers are added; a new feature always needs answers.
 */
export function validateKanoDraft(d: MethodDraft): Validation<MethodDraft, string> {
  const typedCounts = draftCounts(d) !== null;
  const typedPair = d.functional !== undefined || d.dysfunctional !== undefined;
  if (pickedOf(d.category) && !typedCounts && !typedPair) {
    return validateMethodDraft(KANO, d, true);
  }
  if (modeOf(d) === "counts" && !typedCounts) {
    const base = validateMethodDraft(KANO, d);
    const errors = base.ok ? {} : { ...base.errors };
    delete errors.functional;
    delete errors.dysfunctional;
    errors[KANO_COUNT_KEYS.A] = "Enter at least one answer.";
    return { ok: false, errors };
  }
  return validateMethodDraft(KANO, d);
}

/** A row's draft for editing, in the mode its answers are in. */
export function kanoDraftFrom(r: RankedRow): MethodDraft {
  return {
    ...draftFrom(r.row.title, r.values),
    [MODE_KEY]: draftCounts(r.values) ? "counts" : "pair",
  };
}

/**
 * A feature's answers, two ways (add and edit):
 * - "One person's answers": the paired question, "If it has this, how do
 *   you feel?" and "If it doesn't?", each on the five Kano answers; both
 *   unset until picked and both needed.
 * - "Survey counts": how many answer pairs came out A, O, M, I, R and Q,
 *   for a survey tallied elsewhere (a live round saves its own).
 * A live line says what the answers make of it. A category picked by hand
 * on the old page is named, with a prompt to add answers.
 */
export function KanoInputs({ method, draft, update, errors, size }: MethodInputsSlotProps) {
  const mode = modeOf(draft);
  const picked = pickedOf(draft.category);
  const switchTo = (next: AnswerMode) => {
    if (next === mode) return;
    update({ ...cleared(next === "counts" ? PAIR_KEYS : COUNT_KEYS), [MODE_KEY]: next });
  };
  return (
    <div className="space-y-4">
      {picked && (
        <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-sub">
          Picked by hand as {KANO_CATEGORY_LABEL[picked]}. Add answers to derive the category: the
          pick goes once answers are saved.
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <span className="text-sm text-text" aria-hidden="true">
          How you have the answers
        </span>
        <ToggleGroup<AnswerMode>
          label="How you have the answers"
          size={size}
          className="flex-wrap"
          options={[
            { value: "pair", label: "One person's answers" },
            { value: "counts", label: "Survey counts" },
          ]}
          value={mode}
          onValueChange={switchTo}
        />
      </div>
      {mode === "pair" ? (
        <MethodInputs
          method={method}
          draft={draft}
          update={update}
          errors={errors}
          size={size}
          only={PAIR_KEYS}
        />
      ) : (
        <MethodInputs
          method={method}
          draft={draft}
          update={update}
          errors={errors}
          size={size}
          only={COUNT_KEYS}
          className="grid-cols-2 sm:grid-cols-3"
        />
      )}
      <p role="status" className="text-sm text-text">
        {previewText(draft, mode)}
      </p>
    </div>
  );
}

/** Edit a feature in place: Enter saves, Escape cancels, focus starts on the title. */
export function KanoRowEditor({
  ranked,
  onSave,
  onCancel,
}: {
  ranked: RankedRow;
  onSave: (draft: MethodDraft) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<MethodDraft, MethodDraft, string>({
    initial: kanoDraftFrom(ranked),
    validate: validateKanoDraft,
    // Every input goes to the save, a blanked one as a clear.
    onSave: (values) => onSave(withClears(KANO, values)),
    resetOnSave: false,
  });
  const { formRef } = form;
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("input")?.focus();
  }, [formRef]);
  return (
    <ItemForm form={form} submitLabel="Save" onCancel={onCancel}>
      <Field label="Feature title" error={form.errors.title} required>
        {(props) => (
          <Input
            {...props}
            value={form.draft.title}
            onChange={(e) => form.update({ title: e.target.value })}
          />
        )}
      </Field>
      <KanoInputs
        method={KANO}
        draft={form.draft}
        update={form.update}
        errors={form.errors}
        size="sm"
      />
    </ItemForm>
  );
}
