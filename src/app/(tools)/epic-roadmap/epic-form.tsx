"use client";

import { Plus } from "lucide-react";
import { useEffect } from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ItemForm, useItemForm, type ItemFormState } from "@/components/shared/item-form";
import { PersonPicker } from "@/components/team/person-picker";
import type { Epic } from "@/lib/stores/workspace-types";
import { parseNumber, type FormErrors, type Validation } from "@/lib/utils/form";
import { ColorPicker, QuarterPicker } from "./pickers";
import { isEpicColorKey, type EpicColorKey } from "./palette";
import { MAX_QUARTERS_SPAN, currentQuarter, normalizeQuarter, quarterIndex } from "./quarters";
import { rollupLabel, type EpicRollup } from "./rollup";

/** The agents' `add_epic` limits, so a UI edit never stores what they reject. */
const TITLE_MAX = 300;
const OWNER_MAX = 200;
const DESCRIPTION_MAX = 2000;

export interface EpicDraft {
  title: string;
  /** "2026 Q3", or "" until picked. */
  startQuarter: string;
  endQuarter: string;
  owner: string;
  color: EpicColorKey | "";
  description: string;
  /** The typed fallback progress, as typed. Only the editor shows it. */
  progress: string;
}

export interface EpicValues {
  title: string;
  startQuarter: string;
  endQuarter: string;
  owner?: string;
  color: EpicColorKey;
  description?: string;
  /** Absent from the add form: a new epic starts at 0. */
  progress?: number;
}

export type EpicField = keyof EpicDraft;

/** A new epic's draft: this quarter only, and the next unused colour. */
export function newEpicDraft(color: EpicColorKey, now: Date = new Date()): EpicDraft {
  const q = currentQuarter(now);
  return {
    title: "",
    startQuarter: q,
    endQuarter: q,
    owner: "",
    color,
    description: "",
    progress: "",
  };
}

export function epicDraftFrom(epic: Epic, color: EpicColorKey): EpicDraft {
  // Shown as stored (45.5 stays 45.5), clamped; an unreadable value shows blank.
  const p = Number(epic.progress);
  return {
    title: epic.title,
    // An unreadable stored quarter shows as unpicked, and must be picked to save.
    startQuarter: normalizeQuarter(epic.startQuarter),
    endQuarter: normalizeQuarter(epic.endQuarter),
    owner: epic.owner ?? "",
    color,
    description: epic.description ?? "",
    progress: Number.isFinite(p) ? String(Math.min(100, Math.max(0, p))) : "",
  };
}

/**
 * Check a draft. The quarters must be picked and in order: every epic used
 * to take the view's whole range and could never be moved.
 */
export function validateEpic(
  d: EpicDraft,
  { withProgress = false }: { withProgress?: boolean } = {}
): Validation<EpicValues, EpicField> {
  const errors: FormErrors<EpicField> = {};
  const title = d.title.trim();
  if (!title) errors.title = "Name the epic.";
  else if (title.length > TITLE_MAX) errors.title = `Keep the name to ${TITLE_MAX} characters.`;

  const start = normalizeQuarter(d.startQuarter);
  const end = normalizeQuarter(d.endQuarter);
  if (!start) errors.startQuarter = "Pick a start quarter.";
  if (!end) errors.endQuarter = "Pick an end quarter.";
  else if (start && quarterIndex(end) < quarterIndex(start))
    errors.endQuarter = `End on or after the start quarter (${start}).`;
  else if (start && quarterIndex(end) - quarterIndex(start) + 1 > MAX_QUARTERS_SPAN)
    errors.endQuarter = `An epic can span at most ${MAX_QUARTERS_SPAN / 4} years.`;

  const owner = d.owner.trim();
  if (owner.length > OWNER_MAX) errors.owner = `Keep the name to ${OWNER_MAX} characters.`;
  if (!isEpicColorKey(d.color)) errors.color = "Pick a colour.";
  const description = d.description.trim();
  if (description.length > DESCRIPTION_MAX)
    errors.description = `Keep the description to ${DESCRIPTION_MAX.toLocaleString("en-GB")} characters.`;

  let progress: number | undefined;
  if (withProgress) {
    const n = parseNumber(d.progress);
    if (n === undefined) errors.progress = "Enter the progress, 0 to 100.";
    else if (!Number.isFinite(n) || n < 0 || n > 100)
      errors.progress = "Progress runs from 0 to 100.";
    else progress = n;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: {
      title,
      startQuarter: start,
      endQuarter: end,
      color: d.color as EpicColorKey,
      ...(owner ? { owner } : {}),
      ...(description ? { description } : {}),
      ...(progress === undefined ? {} : { progress }),
    },
  };
}

/** The epic with the saved values; a cleared owner or description leaves no empty key. */
export function withEpicValues(epic: Epic, v: EpicValues): Epic {
  const next: Epic = {
    ...epic,
    title: v.title,
    startQuarter: v.startQuarter,
    endQuarter: v.endQuarter,
    color: v.color,
    ...(v.progress === undefined ? {} : { progress: v.progress }),
  };
  if (v.owner) next.owner = v.owner;
  else delete next.owner;
  if (v.description) next.description = v.description;
  else delete next.description;
  return next;
}

/** The fields a save changed, for the history log. */
export function changedFields(epic: Epic, next: Epic): string[] {
  const keys = [
    "title",
    "startQuarter",
    "endQuarter",
    "owner",
    "color",
    "description",
    "progress",
  ] as const;
  return keys.filter((k) => (epic[k] ?? "") !== (next[k] ?? ""));
}

function EpicFields({
  draft,
  update,
  errors,
  also,
  rollup,
  now,
}: {
  draft: EpicDraft;
  update: (patch: Partial<EpicDraft>) => void;
  errors: FormErrors<EpicField>;
  /** The roadmap's quarters, kept in the pickers. */
  also: readonly string[];
  /** The editor's epic, for the typed-progress field; absent in the add form. */
  rollup?: EpicRollup;
  now?: Date;
}) {
  return (
    <>
      <Field label="Epic" error={errors.title} required>
        {(props) => (
          <Input
            {...props}
            value={draft.title}
            onChange={(e) => update({ title: e.target.value })}
            placeholder="e.g. Self-serve onboarding"
          />
        )}
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <QuarterPicker
          label="Start quarter"
          value={draft.startQuarter}
          onChange={(q) => update({ startQuarter: q })}
          also={also}
          now={now}
          error={errors.startQuarter}
          required
        />
        <QuarterPicker
          label="End quarter"
          value={draft.endQuarter}
          onChange={(q) => update({ endQuarter: q })}
          also={also}
          now={now}
          error={errors.endQuarter}
          required
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PersonPicker
          label="Owner"
          value={draft.owner}
          onChange={(owner) => update({ owner })}
          error={errors.owner}
          placeholder="Who drives it"
        />
        <ColorPicker
          value={draft.color}
          onChange={(color) => update({ color })}
          error={errors.color}
        />
      </div>
      {rollup && (
        <Field
          label="Progress, typed (%)"
          error={errors.progress}
          hint={
            rollup.source === "stories"
              ? `Not used while stories are linked: ${rollupLabel(rollup).toLowerCase()} gives ${rollup.pct}%.`
              : "Used while no stories are linked. Link stories to roll it up instead."
          }
          className="sm:max-w-[16rem]"
        >
          {(props) => (
            <Input
              {...props}
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              value={draft.progress}
              onChange={(e) => update({ progress: e.target.value })}
              className="font-data"
            />
          )}
        </Field>
      )}
      <Field
        label="Description"
        hint="Optional: the outcome it delivers."
        error={errors.description}
      >
        {(props) => (
          <Textarea
            {...props}
            rows={2}
            value={draft.description}
            onChange={(e) => update({ description: e.target.value })}
            className="resize-y"
          />
        )}
      </Field>
    </>
  );
}

/** The add form's state; the client owns it to start the next draft on the next colour. */
export function useEpicAddForm(
  initial: () => EpicDraft,
  onAdd: (values: EpicValues) => void
): ItemFormState<EpicDraft, EpicField> {
  return useItemForm<EpicDraft, EpicValues, EpicField>({
    initial,
    validate: (d) => validateEpic(d),
    onSave: onAdd,
    // The client resets with the next colour once the epic is added.
    resetOnSave: false,
  });
}

/** "Add epic": the current quarter only until other quarters are picked. */
export function EpicAddForm({
  form,
  also,
  now,
}: {
  form: ItemFormState<EpicDraft, EpicField>;
  also: readonly string[];
  now?: Date;
}) {
  return (
    <ItemForm
      form={form}
      submitLabel="Add epic"
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
    >
      <EpicFields
        draft={form.draft}
        update={form.update}
        errors={form.errors}
        also={also}
        now={now}
      />
    </ItemForm>
  );
}

/** Edit an epic in place. Enter saves, Escape cancels. */
export function EpicEditor({
  epic,
  color,
  rollup,
  also,
  now,
  onSave,
  onCancel,
}: {
  epic: Epic;
  color: EpicColorKey;
  rollup: EpicRollup;
  also: readonly string[];
  now?: Date;
  onSave: (values: EpicValues) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<EpicDraft, EpicValues, EpicField>({
    initial: () => epicDraftFrom(epic, color),
    validate: (d) => validateEpic(d, { withProgress: true }),
    onSave,
    resetOnSave: false,
  });
  const { formRef } = form;
  // Open on the name, so the keyboard user lands where they were heading.
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("input")?.focus();
  }, [formRef]);
  return (
    <ItemForm form={form} submitLabel="Save" onCancel={onCancel}>
      <EpicFields
        draft={form.draft}
        update={form.update}
        errors={form.errors}
        also={also}
        rollup={rollup}
        now={now}
      />
    </ItemForm>
  );
}
