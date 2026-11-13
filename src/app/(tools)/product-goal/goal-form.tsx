"use client";

/**
 * The goal's form: the statement, why it matters, the measures (one a line)
 * and a target date, with the check list reading the draft as it is typed.
 * A new goal while another is active also asks how the current one ended.
 * "Draft with Amr" suggests goals from the vision and the backlog; picking
 * one fills the form, and nothing is saved until Save.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Save } from "lucide-react";
import { AiButton, AiSuggestions } from "@/components/ai";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { AiSource } from "@/lib/ai/task-types";
import {
  GOAL_DRAFT_STORIES_MAX,
  productGoalDraftTask,
  type DraftedGoal,
} from "@/lib/ai/tasks/product-goal";
import {
  GOAL_STATUS_LABEL,
  goalChecks,
  validateGoalDraft,
  validateNote,
  type GoalDraft,
  type GoalField,
  type GoalOutcome,
  type GoalValues,
} from "@/lib/product-goal/model";
import { TOOL_TEXT_MAX } from "@/lib/stores/workspace-types";
import type { Validation } from "@/lib/utils/form";
import { CheckList } from "./check-list";

type FormField = GoalField | "note";
type FormDraft = GoalDraft & { closeAs: GoalOutcome; note: string };
export type GoalFormValues = GoalValues & { closeAs: GoalOutcome; note?: string };

export interface GoalFormProps {
  initial: GoalDraft;
  /** The active goal this one replaces (a new goal while one is active). */
  replacing?: string;
  vision: string;
  /** Backlog story titles, in order, for Ask Amr. */
  storyTitles: readonly string[];
  submitLabel: string;
  onSave: (values: GoalFormValues) => void;
  onCancel?: () => void;
}

export function GoalForm({
  initial,
  replacing,
  vision,
  storyTitles,
  submitLabel,
  onSave,
  onCancel,
}: GoalFormProps) {
  const validate = (d: FormDraft): Validation<GoalFormValues, FormField> => {
    const goal = validateGoalDraft(d);
    const note = replacing ? validateNote(d.note) : ({ ok: true, values: undefined } as const);
    if (!goal.ok || !note.ok) {
      return {
        ok: false,
        errors: { ...(goal.ok ? {} : goal.errors), ...(note.ok ? {} : note.errors) },
      };
    }
    return {
      ok: true,
      values: { ...goal.values, closeAs: d.closeAs, ...(note.values ? { note: note.values } : {}) },
    };
  };
  const form = useItemForm<FormDraft, GoalFormValues, FormField>({
    initial: { ...initial, closeAs: "achieved", note: "" },
    validate,
    onSave,
    resetOnSave: false,
  });
  const first = useRef<HTMLTextAreaElement>(null);
  useEffect(() => first.current?.focus(), []);
  const [drafts, setDrafts] = useState<{ goals: DraftedGoal[]; source: AiSource } | null>(null);

  const checks = useMemo(
    () =>
      goalChecks(
        {
          statement: form.draft.statement,
          measures: form.draft.measures.split(/\r?\n/).filter((m) => m.trim()),
        },
        vision
      ),
    [form.draft.statement, form.draft.measures, vision]
  );

  const takeDraft = (g: DraftedGoal) => {
    form.update({
      statement: g.statement,
      why: g.why ?? "",
      measures: g.measures.join("\n"),
    });
    setDrafts(null);
    first.current?.focus();
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <AiButton
          task={productGoalDraftTask}
          label="Draft goals with Amr"
          fallbackLabel="Suggest goal templates"
          input={() => ({
            vision: vision.slice(0, 2000),
            stories: storyTitles
              .slice(0, GOAL_DRAFT_STORIES_MAX)
              .map((t) => t.slice(0, 200))
              .filter((t) => t.trim()),
            ...(replacing ? { current: replacing.slice(0, 1000) } : {}),
          })}
          onResult={(data, meta) => setDrafts({ goals: data.goals, source: meta.source })}
        />
        {drafts && (
          <AiSuggestions
            items={drafts.goals}
            source={drafts.source}
            title="Goals to start from"
            acceptLabel="Use"
            render={(g) => ({
              title: g.statement,
              detail: [g.why, g.measures.length ? `Measures: ${g.measures.join("; ")}` : ""]
                .filter(Boolean)
                .join(" "),
            })}
            onAccept={takeDraft}
            // One goal at a time: "Use all" would just keep the last one.
            onAcceptAll={(goals) => goals[0] && takeDraft(goals[0])}
            onDismiss={() => setDrafts(null)}
          />
        )}
      </div>
      <ItemForm
        form={form}
        submitLabel={submitLabel}
        submitIcon={<Save className="h-4 w-4" aria-hidden="true" />}
        onCancel={onCancel}
      >
        <Field
          label="The goal"
          hint="One sentence about the outcome you want, not a list of features."
          error={form.errors.statement}
        >
          {(control) => (
            <Textarea
              {...control}
              ref={first}
              rows={2}
              maxLength={TOOL_TEXT_MAX.text}
              value={form.draft.statement}
              onChange={(e) => form.update({ statement: e.target.value })}
            />
          )}
        </Field>
        <Field label="Why it matters" error={form.errors.why}>
          {(control) => (
            <Textarea
              {...control}
              rows={2}
              maxLength={TOOL_TEXT_MAX.text}
              value={form.draft.why}
              onChange={(e) => form.update({ why: e.target.value })}
            />
          )}
        </Field>
        <Field
          label="How you'll know"
          hint="One measure a line, such as “Share of shops with no card machine: 70%”."
          error={form.errors.measures}
        >
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              value={form.draft.measures}
              onChange={(e) => form.update({ measures: e.target.value })}
            />
          )}
        </Field>
        <Field label="Target date" hint="Optional." error={form.errors.targetDate}>
          {(control) => (
            <Input
              {...control}
              type="date"
              value={form.draft.targetDate}
              onChange={(e) => form.update({ targetDate: e.target.value })}
              className="sm:max-w-[12rem]"
            />
          )}
        </Field>
        {replacing && (
          <fieldset className="space-y-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-sm font-medium text-text">
              How did the current goal end?
            </legend>
            <p className="text-xs text-sub break-words">“{replacing}”</p>
            <div className="flex flex-wrap gap-4">
              {(["achieved", "abandoned"] as const).map((o) => (
                <label key={o} className="flex min-h-11 items-center gap-2 text-sm text-text">
                  <input
                    type="radio"
                    name="close-as"
                    value={o}
                    checked={form.draft.closeAs === o}
                    onChange={() => form.update({ closeAs: o })}
                    className="h-4 w-4 accent-accent"
                  />
                  {GOAL_STATUS_LABEL[o]}
                </label>
              ))}
            </div>
            <Field label="A note on how it ended" hint="Optional." error={form.errors.note}>
              {(control) => (
                <Textarea
                  {...control}
                  rows={2}
                  maxLength={TOOL_TEXT_MAX.text}
                  value={form.draft.note}
                  onChange={(e) => form.update({ note: e.target.value })}
                />
              )}
            </Field>
          </fieldset>
        )}
        <CheckList checks={checks} title="Check list, as you type" />
      </ItemForm>
    </div>
  );
}
