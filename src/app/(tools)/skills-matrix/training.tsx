"use client";

import { CheckCircle2, GraduationCap, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { DayInput } from "@/components/shared/day-input";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { PersonPicker } from "@/components/team/person-picker";
import { findRosterMember } from "@/lib/team/names";
import { isIsoDate } from "@/lib/sprints/calendar";
import type { Validation } from "@/lib/utils/form";
import type { SkillsMatrix, SkillsTrainingPair } from "@/lib/stores/workspace-types";
import {
  TARGET_LEVELS,
  isTargetLevel,
  proficiencyName,
  trainingDoneError,
  trainingError,
  trainingReached,
  type NewTrainingPair,
  type SkillColumn,
  type SkillCoverage,
  type SkillTargetLevel,
  type TrainingSuggestion,
} from "@/lib/skills/coverage";

export interface PairDraft {
  skillId: string;
  /** Names, as PersonPicker gives them. */
  learner: string;
  mentor: string;
  /** "" = the skill's target level. */
  toLevel: "" | `${SkillTargetLevel}`;
  /** "YYYY-MM-DD" or "". */
  due: string;
}

export type PairField = keyof PairDraft;

export const EMPTY_PAIR: PairDraft = { skillId: "", learner: "", mentor: "", toLevel: "", due: "" };

/** The skill's target level, or Intermediate without one. */
export function skillTargetLevel(doc: SkillsMatrix, skillId: string): SkillTargetLevel {
  const level = doc.skills.find((s) => s.id === skillId)?.targetLevel;
  return isTargetLevel(level) ? level : 2;
}

/**
 * Check a new pair. People are picked by name and must be on the matrix
 * (PersonPicker offers "Add to the team" for someone who isn't); the
 * mentor is optional (blank is outside help). The rest is the same check
 * the agent's add_training runs (trainingError).
 */
export function validatePair(
  d: PairDraft,
  doc: SkillsMatrix,
  columns: readonly SkillColumn[]
): Validation<NewTrainingPair, PairField> {
  const errors: Partial<Record<PairField, string>> = {};
  if (!d.skillId) errors.skillId = "Pick the skill to learn.";
  const learner = findRosterMember(columns, d.learner);
  if (!d.learner.trim()) errors.learner = "Pick who learns it.";
  else if (!learner)
    errors.learner = `“${d.learner.trim()}” isn't on the matrix. Add them to the team first.`;
  const mentor = d.mentor.trim() ? findRosterMember(columns, d.mentor) : undefined;
  if (d.mentor.trim() && !mentor) {
    errors.mentor = `“${d.mentor.trim()}” isn't on the matrix. Leave it empty for outside help.`;
  } else if (mentor && learner && mentor.id === learner.id) {
    errors.mentor = "The mentor can't be the learner.";
  }
  if (Object.keys(errors).length > 0 || !learner) return { ok: false, errors };
  const values: NewTrainingPair = {
    skillId: d.skillId,
    learnerId: learner.id,
    ...(mentor ? { mentorId: mentor.id } : {}),
    toLevel: d.toLevel ? (Number(d.toLevel) as SkillTargetLevel) : skillTargetLevel(doc, d.skillId),
    ...(d.due ? { due: d.due } : {}),
  };
  const error = trainingError(values, doc, columns);
  if (error) {
    const field: PairField = error.startsWith("Pick a due") ? "due" : "learner";
    return { ok: false, errors: { [field]: error } };
  }
  return { ok: true, values };
}

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const REASON: Record<TrainingSuggestion["reason"], string> = {
  gap: "nobody on the team has it at Intermediate yet",
  spof: "only one person has it",
  "below-target": "it's below its target",
};

/** Why a due day can't be saved in place, or null: a real day, or empty for none. */
export const dueDayError = (day: string): string | null =>
  day === "" || isIsoDate(day) ? null : "Pick a real day, or leave it empty.";

export interface TrainingHandlers {
  onAddSuggestion: (s: TrainingSuggestion) => void;
  onAdd: (values: NewTrainingPair) => void;
  onDone: (pair: SkillsTrainingPair, done: boolean) => void;
  /** Move the day a done pair was finished (backdating it). */
  onDoneDay: (pair: SkillsTrainingPair, day: string) => void;
  onDue: (pair: SkillsTrainingPair, due: string) => void;
  onRemove: (pair: SkillsTrainingPair) => void;
}

/**
 * The example's people as a plain choice: PersonPicker suggests and checks
 * the real Team page roster, which the example's pairs can't use.
 */
function ColumnSelect({
  label,
  value,
  columns,
  onChange,
  error,
  required,
  emptyLabel,
}: {
  label: string;
  value: string;
  columns: readonly SkillColumn[];
  onChange: (name: string) => void;
  error?: string;
  required?: boolean;
  emptyLabel: string;
}) {
  return (
    <Field label={label} error={error} required={required}>
      {(props) => (
        <select
          {...props}
          className={SELECT_CLASS}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">{emptyLabel}</option>
          {columns.map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/**
 * The cross-training plan: suggested pairs for the skills at risk, the
 * pairs the team agreed, and a form for its own. Done is the team's call:
 * a learner whose rating reaches the level gets a "mark done?" hint, never
 * a silent tick.
 */
export function TrainingPlan({
  doc,
  columns,
  coverage,
  suggestions,
  today,
  preview,
  handlers,
}: {
  doc: SkillsMatrix;
  columns: readonly SkillColumn[];
  coverage: readonly SkillCoverage[];
  suggestions: readonly TrainingSuggestion[];
  today: string;
  preview: boolean;
  handlers: TrainingHandlers;
}) {
  const nameOf = (id: string | undefined) => columns.find((c) => c.id === id)?.name ?? "Someone";
  const skillOf = (id: string) => doc.skills.find((s) => s.id === id)?.name ?? "a skill";
  const pairs = doc.training ?? [];
  const open = pairs.filter((p) => !p.doneAt);
  const done = pairs.filter((p) => p.doneAt);
  const form = useItemForm<PairDraft, NewTrainingPair, PairField>({
    initial: EMPTY_PAIR,
    validate: (d) => validatePair(d, doc, columns),
    onSave: handlers.onAdd,
  });
  const { draft, update, errors } = form;

  const pairRow = (p: SkillsTrainingPair) => {
    const learner = nameOf(p.learnerId);
    const skill = skillOf(p.skillId);
    const reached = !p.doneAt && trainingReached(doc, p, columns);
    const overdue = !p.doneAt && !!p.due && p.due < today;
    return (
      <li key={p.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1 text-sm">
          <p className={p.doneAt ? "text-sub line-through" : "text-text"}>
            <span className="font-medium">{learner}</span> learns {skill} to{" "}
            {proficiencyName(p.toLevel)}
            <span className="text-sub">
              {" "}
              · {p.mentorId ? `with ${nameOf(p.mentorId)}` : "outside help"}
            </span>
          </p>
          {p.doneAt && (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-sub">
              <span aria-hidden="true">Done on</span>
              <DayInput
                label={`Day ${learner} finished learning ${skill}`}
                value={p.doneAt}
                max={today}
                validate={(day) => trainingDoneError(day, today)}
                onCommit={(day) => handlers.onDoneDay(p, day)}
                inputClassName="h-8 w-40"
              />
            </div>
          )}
          {overdue && <p className="text-xs text-warning">Overdue since {p.due}</p>}
          {reached && (
            <p className="text-xs text-success">
              Reached {proficiencyName(p.toLevel)} on the matrix: mark it done?
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!p.doneAt && (
            <DayInput
              label={`Due day for ${learner} learning ${skill}`}
              value={p.due ?? ""}
              validate={dueDayError}
              onCommit={(day) => handlers.onDue(p, day)}
              inputClassName="h-8 w-40"
            />
          )}
          {p.doneAt ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => handlers.onDone(p, false)}
            >
              <RotateCcw aria-hidden="true" />
              Reopen
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => handlers.onDone(p, true)}
            >
              <CheckCircle2 aria-hidden="true" />
              Done
            </Button>
          )}
          <IconButton
            label={`Delete the pair: ${learner} learns ${skill}`}
            icon={<Trash2 className="h-3.5 w-3.5" />}
            className="h-8 w-8 text-sub hover:text-danger"
            onClick={() => handlers.onRemove(p)}
          />
        </div>
      </li>
    );
  };

  const atRisk = coverage.filter((c) => c.gap || c.spof || c.meetsTarget === false).length;

  return (
    <div className="space-y-4">
      {suggestions.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-text">Suggested pairs</h3>
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {suggestions.map((s) => (
              <li
                key={`${s.skillId}:${s.learnerId}`}
                className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center"
              >
                <p className="min-w-0 flex-1 text-sm text-text">
                  <span className="font-medium">{nameOf(s.learnerId)}</span> could learn{" "}
                  {skillOf(s.skillId)} to {proficiencyName(s.toLevel)}{" "}
                  {s.mentorId ? `with ${nameOf(s.mentorId)}` : "with outside help"}
                  <span className="text-sub"> · {REASON[s.reason]}</span>
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => handlers.onAddSuggestion(s)}
                  aria-label={`Add to plan: ${nameOf(s.learnerId)} learns ${skillOf(s.skillId)}`}
                >
                  <Plus aria-hidden="true" />
                  Add to plan
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-sub">
          {atRisk === 0
            ? "No skill is at risk, so there's nothing to suggest."
            : "No more pairs to suggest: rate the people still Not rated, or the plan already covers the skills at risk."}
        </p>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-text">
          The plan{pairs.length > 0 ? ` (${open.length} open)` : ""}
        </h3>
        {pairs.length === 0 ? (
          <p className="text-sm text-sub">No pairs yet. Add a suggestion, or plan one below.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {[...open, ...done].map(pairRow)}
          </ul>
        )}
      </div>

      {doc.skills.length > 0 && columns.length > 0 && (
        <ItemForm
          form={form}
          submitLabel="Add pair"
          submitIcon={<GraduationCap className="h-4 w-4" aria-hidden="true" />}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Skill" error={errors.skillId} required>
              {(props) => (
                <select
                  {...props}
                  className={SELECT_CLASS}
                  value={draft.skillId}
                  onChange={(e) => update({ skillId: e.target.value })}
                >
                  <option value="">Pick a skill</option>
                  {doc.skills.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {preview ? (
              <>
                <ColumnSelect
                  label="Learner"
                  required
                  value={draft.learner}
                  columns={columns}
                  onChange={(learner) => update({ learner })}
                  error={errors.learner}
                  emptyLabel="Pick who learns it"
                />
                <ColumnSelect
                  label="Mentor"
                  value={draft.mentor}
                  columns={columns}
                  onChange={(mentor) => update({ mentor })}
                  error={errors.mentor}
                  emptyLabel="Outside help"
                />
              </>
            ) : (
              <>
                <PersonPicker
                  label="Learner"
                  required
                  value={draft.learner}
                  onChange={(learner) => update({ learner })}
                  error={errors.learner}
                />
                <PersonPicker
                  label="Mentor"
                  value={draft.mentor}
                  onChange={(mentor) => update({ mentor })}
                  error={errors.mentor}
                  hint="Empty: outside help"
                />
              </>
            )}
            <Field label="Up to" error={errors.toLevel}>
              {(props) => (
                <select
                  {...props}
                  className={SELECT_CLASS}
                  value={draft.toLevel}
                  onChange={(e) => update({ toLevel: e.target.value as PairDraft["toLevel"] })}
                >
                  <option value="">The skill&apos;s target level</option>
                  {TARGET_LEVELS.map((l) => (
                    <option key={l} value={String(l)}>
                      {proficiencyName(l)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Due" error={errors.due}>
              {(props) => (
                <Input
                  {...props}
                  type="date"
                  value={draft.due}
                  onChange={(e) => update({ due: e.target.value })}
                />
              )}
            </Field>
          </div>
        </ItemForm>
      )}
    </div>
  );
}
