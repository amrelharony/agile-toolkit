"use client";

import { Plus } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { parseNumber, type Validation } from "@/lib/utils/form";
import type { SkillsMatrix } from "@/lib/stores/workspace-types";
import {
  SKILL_DESCRIPTION_MAX,
  SKILL_NAME_MAX,
  TARGET_LEVELS,
  TARGET_LEVEL_LABEL,
  isTargetLevel,
  skillNameError,
  targetPeopleError,
  type NewSkill,
  type SkillTargetLevel,
} from "@/lib/skills/coverage";

export interface SkillDraft {
  name: string;
  /** As typed; "" for no target. */
  targetPeople: string;
  /** "" keeps the default (Intermediate or above). */
  targetLevel: "" | `${SkillTargetLevel}`;
  description: string;
}

export type SkillField = keyof SkillDraft;

export const EMPTY_SKILL: SkillDraft = {
  name: "",
  targetPeople: "",
  targetLevel: "",
  description: "",
};

/**
 * Check a new skill. The name is required and can't repeat one on the
 * matrix (by name key, so "react" and "React " are the same skill). A
 * target is optional and can't ask for more people than the team has.
 */
export function validateSkill(
  d: SkillDraft,
  doc: SkillsMatrix | null | undefined,
  teamSize: number
): Validation<NewSkill, SkillField> {
  const errors: Partial<Record<SkillField, string>> = {};
  const nameError = skillNameError(d.name, doc);
  if (nameError) errors.name = nameError;
  const people = parseNumber(d.targetPeople);
  // Blank is no target; anything else typed must be a whole number of people.
  const peopleError = targetPeopleError(people ?? null, teamSize);
  if (peopleError) errors.targetPeople = peopleError;
  const level = d.targetLevel === "" ? undefined : Number(d.targetLevel);
  if (level !== undefined && !isTargetLevel(level)) errors.targetLevel = "Pick a level.";
  if (d.description.trim().length > SKILL_DESCRIPTION_MAX) {
    errors.description = `Keep it to ${SKILL_DESCRIPTION_MAX} characters.`;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const description = d.description.trim();
  return {
    ok: true,
    values: {
      name: d.name.trim(),
      ...(description ? { description } : {}),
      ...(people !== undefined ? { targetPeople: people } : {}),
      ...(level !== undefined && isTargetLevel(level) ? { targetLevel: level } : {}),
    },
  };
}

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** "Add a skill": nothing is saved until it has a name no other skill has. */
export function SkillForm({
  doc,
  teamSize,
  onAdd,
}: {
  doc: SkillsMatrix;
  teamSize: number;
  onAdd: (values: NewSkill) => void;
}) {
  const form = useItemForm<SkillDraft, NewSkill, SkillField>({
    initial: EMPTY_SKILL,
    validate: (d) => validateSkill(d, doc, teamSize),
    onSave: onAdd,
  });
  const { draft, update, errors } = form;
  return (
    <ItemForm
      form={form}
      submitLabel="Add skill"
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_9rem_12rem]">
        <Field label="Skill" error={errors.name} required className="sm:col-span-2 lg:col-span-1">
          {(props) => (
            <Input
              {...props}
              value={draft.name}
              maxLength={SKILL_NAME_MAX}
              onChange={(e) => update({ name: e.target.value })}
              placeholder="e.g. Kubernetes"
            />
          )}
        </Field>
        <Field
          label="Target people"
          error={errors.targetPeople}
          hint="Optional: how many people it needs"
        >
          {(props) => (
            <Input
              {...props}
              type="number"
              inputMode="numeric"
              min={1}
              value={draft.targetPeople}
              onChange={(e) => update({ targetPeople: e.target.value })}
            />
          )}
        </Field>
        <Field label="At level" error={errors.targetLevel}>
          {(props) => (
            <select
              {...props}
              className={SELECT_CLASS}
              value={draft.targetLevel}
              onChange={(e) => update({ targetLevel: e.target.value as SkillDraft["targetLevel"] })}
            >
              <option value="">{TARGET_LEVEL_LABEL[2]} (default)</option>
              {TARGET_LEVELS.filter((l) => l !== 2).map((l) => (
                <option key={l} value={String(l)}>
                  {TARGET_LEVEL_LABEL[l]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field
          label="Description"
          error={errors.description}
          className="sm:col-span-2 lg:col-span-3"
        >
          {(props) => (
            <Input
              {...props}
              value={draft.description}
              maxLength={SKILL_DESCRIPTION_MAX}
              onChange={(e) => update({ description: e.target.value })}
              placeholder="Optional: what it covers"
            />
          )}
        </Field>
      </div>
    </ItemForm>
  );
}
