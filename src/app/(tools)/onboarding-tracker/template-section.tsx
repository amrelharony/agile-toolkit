"use client";

import { ListChecks, Plus, Trash2 } from "lucide-react";
import { Field, type FieldControlProps } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { ResetButton } from "@/components/shared/reset-button";
import { SectionCard } from "@/components/shared/section-card";
import { parseNumber, type Validation } from "@/lib/utils/form";
import { removeWithUndo } from "@/lib/utils/undoable";
import { NameField, TargetField } from "./fields";
import {
  MARK_LABELS,
  TARGET_MAX,
  isTarget,
  type MilestoneMark,
  type MilestoneTemplate,
} from "./model";

const SELECT_CLASS =
  "h-8 rounded-md border border-input bg-background px-2 text-xs text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type TemplateUpdate = (fn: (list: readonly MilestoneTemplate[]) => MilestoneTemplate[]) => void;

interface TemplateDraft {
  name: string;
  targetDays: string;
  marks: "" | MilestoneMark;
}
type TemplateField = keyof TemplateDraft;
type TemplateValues = Omit<MilestoneTemplate, "id">;

/** A new milestone for the template: a name and a whole number of days. */
export function validateTemplate(d: TemplateDraft): Validation<TemplateValues, TemplateField> {
  const errors: Partial<Record<TemplateField, string>> = {};
  const name = d.name.replace(/\s+/g, " ").trim();
  const target = parseNumber(d.targetDays);
  if (!name) errors.name = "Name the milestone.";
  if (target === undefined) errors.targetDays = "Give it a target in days.";
  else if (!isTarget(target)) errors.targetDays = `A whole number of days, 1 to ${TARGET_MAX}.`;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: { name, targetDays: target as number, ...(d.marks ? { marks: d.marks } : {}) },
  };
}

/** One milestone per mark: the one that just got it keeps it, the others lose it. */
export function withMark(
  list: readonly MilestoneTemplate[],
  mark: MilestoneMark | undefined,
  ownerId: string
): MilestoneTemplate[] {
  if (!mark) return [...list];
  return list.map((t) => {
    if (t.marks !== mark || t.id === ownerId) return t;
    const next = { ...t };
    delete next.marks;
    return next;
  });
}

function MarkSelect({
  value,
  onChange,
  label,
  ...control
}: {
  value: "" | MilestoneMark;
  onChange: (mark: "" | MilestoneMark) => void;
  label?: string;
} & Partial<FieldControlProps>) {
  return (
    <select
      {...control}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as "" | MilestoneMark)}
      className={SELECT_CLASS}
    >
      <option value="">No KPI</option>
      <option value="first-pr">Counts as {MARK_LABELS["first-pr"]}</option>
      <option value="productive">Counts as {MARK_LABELS.productive}</option>
    </select>
  );
}

/**
 * The milestones a new joiner starts with: rename, retarget, mark the one
 * that counts as the first PR or as productive (one each), add and remove
 * (with Undo), or go back to the built-ins. Changes apply to people added
 * afterwards; everyone already here keeps their own copy.
 */
export function TemplateSection({
  templates,
  custom,
  onChange,
  onRestoreBuiltIns,
  onRestoreUndo,
}: {
  templates: readonly MilestoneTemplate[];
  /** Whether a template is saved (false: the built-ins). */
  custom: boolean;
  onChange: TemplateUpdate;
  onRestoreBuiltIns: () => void;
  onRestoreUndo: () => void;
}) {
  const form = useItemForm<TemplateDraft, TemplateValues, TemplateField>({
    initial: { name: "", targetDays: "", marks: "" },
    validate: validateTemplate,
    onSave: (values) => {
      const id = crypto.randomUUID();
      onChange((list) => withMark([...list, { id, ...values }], values.marks, id));
    },
  });
  const { draft, update, errors } = form;

  const patch = (id: string, p: Partial<MilestoneTemplate>) =>
    onChange((list) =>
      withMark(
        list.map((t) => (t.id === id ? { ...t, ...p } : t)),
        p.marks,
        id
      )
    );

  const remove = (t: MilestoneTemplate) =>
    removeWithUndo<MilestoneTemplate>({
      label: `Removed “${t.name}” from the template`,
      update: onChange,
      match: (x) => x.id === t.id,
    });

  return (
    <SectionCard
      title="Milestone template"
      icon={ListChecks}
      contentClassName="space-y-3"
      actions={
        custom ? (
          <ResetButton
            label="Use the built-ins"
            title="Go back to the built-in milestones?"
            description="New joiners will start with the six built-in milestones. People already here keep theirs."
            confirmLabel="Use the built-ins"
            doneLabel="Back to the built-in milestones"
            onReset={onRestoreBuiltIns}
            onUndo={onRestoreUndo}
          />
        ) : undefined
      }
    >
      <p className="text-xs text-sub">
        New joiners start with these. Edits apply to people you add from now on; everyone already
        here keeps their own copy, which you can edit on their card.
      </p>
      {templates.length === 0 ? (
        <p className="text-xs text-sub">No milestones: new joiners start with none.</p>
      ) : (
        <ul
          className="divide-y divide-border rounded-lg border border-border"
          aria-label="Milestone template"
        >
          {templates.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <NameField
                value={t.name}
                label={`Template milestone: ${t.name}`}
                onCommit={(name) => patch(t.id, { name })}
                className="min-w-0 flex-1 basis-40"
              />
              <TargetField
                value={t.targetDays}
                label={`Target days for ${t.name}`}
                onCommit={(targetDays) => patch(t.id, { targetDays })}
              />
              <MarkSelect
                value={t.marks ?? ""}
                label={`KPI for ${t.name}`}
                onChange={(marks) => patch(t.id, { marks: marks || undefined })}
              />
              <IconButton
                label={`Remove ${t.name} from the template`}
                icon={<Trash2 className="h-3.5 w-3.5" />}
                className="h-8 w-8 text-sub hover:text-danger"
                onClick={() => remove(t)}
              />
            </li>
          ))}
        </ul>
      )}
      <ItemForm
        form={form}
        submitLabel="Add milestone"
        submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_12rem]">
          <Field label="Milestone" error={errors.name}>
            {(props) => (
              <Input
                {...props}
                value={draft.name}
                maxLength={80}
                onChange={(e) => update({ name: e.target.value })}
                placeholder="e.g. First on-call shift"
              />
            )}
          </Field>
          <Field label="Target (days)" error={errors.targetDays}>
            {(props) => (
              <Input
                {...props}
                type="number"
                inputMode="numeric"
                min={1}
                max={TARGET_MAX}
                value={draft.targetDays}
                onChange={(e) => update({ targetDays: e.target.value })}
              />
            )}
          </Field>
          <Field label="KPI">
            {(props) => (
              <MarkSelect {...props} value={draft.marks} onChange={(marks) => update({ marks })} />
            )}
          </Field>
        </div>
      </ItemForm>
    </SectionCard>
  );
}
