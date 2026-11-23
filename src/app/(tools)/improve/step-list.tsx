"use client";

/**
 * One list for both methods: an A3's countermeasures (what, how you'll know
 * it worked, owner, due, status, sent once to Retro Actions or the Backlog,
 * with its owner and date) and a Kata's
 * experiments (what we'll try, what we expect, what happened, what we
 * learned, and the obstacle it works on). A sent countermeasure reads as
 * done once it is done there. A Kata experiment can't run without what the
 * team expects. Deletes come with Undo, and focus moves to the next row.
 */

import { useEffect, useId, useState, type ReactNode } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { SendToMenu } from "@/components/handoff/send-to-menu";
import { BlurInput, BlurTextarea } from "@/components/shared/blur-fields";
import { DayInput } from "@/components/shared/day-input";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { PersonPicker } from "@/components/team/person-picker";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { liveLink } from "@/lib/handoffs/registry";
import {
  IMPROVEMENT_STEP_STATUSES,
  TOOL_LIST_MAX,
  TOOL_TEXT_MAX,
  type Improvement,
  type ImprovementStep,
  type ImprovementStepStatus,
} from "@/lib/stores/workspace-types";
import {
  IMPROVE_TOOL,
  STEP_ROUTES,
  STEP_STATUS_LABEL,
  isDay,
  type StepDone,
} from "@/lib/improve/model";
import type { Validation } from "@/lib/utils/form";
import { FieldLabel, PersonField, SELECT_CLASS, dayProblem } from "./fields";
import { short, type ItemActions } from "./use-item-actions";

/** Focus goes to the add form's first field. */
const ADD = "add";

export interface StepDraft {
  text: string;
  owner: string;
  due: string;
  expect: string;
  obstacleId: string;
}

export type StepDraftField = keyof StepDraft;

/** A new step's draft checked: what to do, within its cap, and a real due day. */
export function validateStepDraft(draft: StepDraft): Validation<StepDraft, StepDraftField> {
  const errors: Partial<Record<StepDraftField, string>> = {};
  const text = draft.text.trim();
  if (!text) errors.text = "Say what you'll do.";
  else if (text.length > TOOL_TEXT_MAX.text)
    errors.text = `Keep it to ${TOOL_TEXT_MAX.text} characters.`;
  if (draft.expect.trim().length > TOOL_TEXT_MAX.text)
    errors.expect = `Keep it to ${TOOL_TEXT_MAX.text} characters.`;
  if (draft.due && !isDay(draft.due)) errors.due = "Give the date as a real day.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, values: { ...draft, text } };
}

/** Where a sent step's done state came from, when it wasn't ticked here. */
function doneThere(step: ImprovementStep, done: StepDone): string | null {
  if (step.status === "done" || !done(step).done) return null;
  return step.sentTo?.some((l) => l.route === "backlog-story")
    ? "Done in the backlog"
    : "Done in Retro Actions";
}

function StatusSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: ImprovementStepStatus;
  onChange: (status: ImprovementStepStatus) => void;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as ImprovementStepStatus)}
      className={SELECT_CLASS}
    >
      {IMPROVEMENT_STEP_STATUSES.map((s) => (
        <option key={s} value={s}>
          {STEP_STATUS_LABEL[s]}
        </option>
      ))}
    </select>
  );
}

function StepRow({
  item,
  step,
  index,
  rowId,
  done,
  actions,
  onDelete,
}: {
  item: Improvement;
  step: ImprovementStep;
  index: number;
  rowId: string;
  done: StepDone;
  actions: ItemActions;
  onDelete: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const kata = item.method === "kata";
  const there = doneThere(step, done);
  const patch = (p: Parameters<ItemActions["patchStep"]>[1]) =>
    setError(actions.patchStep(step.id, p));
  const sentOn = STEP_ROUTES.find((r) => liveLink(step.sentTo, r));
  const label = `${kata ? "Experiment" : "Countermeasure"} ${index + 1}`;

  return (
    <li className="space-y-3 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 basis-full space-y-1 sm:basis-0 sm:flex-1">
          <FieldLabel htmlFor={`${rowId}-text`}>
            {label}: {kata ? "what we'll try" : "what we'll change"}
          </FieldLabel>
          <BlurInput
            id={`${rowId}-text`}
            value={step.text}
            maxLength={TOOL_TEXT_MAX.text}
            onCommit={(text) => {
              if (text.trim()) patch({ text });
            }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1 sm:mt-5">
          {!kata && !actions.example && step.status !== "dropped" && (
            <SendToMenu
              routes={sentOn ? [sentOn] : STEP_ROUTES}
              item={{
                title: step.text.split("\n")[0] ?? step.text,
                description: `From the A3 “${item.title}”.`,
                ...(step.owner ? { owner: step.owner } : {}),
                ...(step.due ? { due: step.due } : {}),
                sourceRef: { tool: IMPROVE_TOOL, id: step.id, doc: item.id },
              }}
              sentTo={step.sentTo}
              onLinksChange={(update) => actions.stepLinks(step.id, update)}
            />
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onDelete}
            aria-label={`Delete ${label.toLowerCase()}: ${short(step.text)}`}
            className="gap-1.5 text-sub hover:text-danger"
          >
            <Trash2 aria-hidden="true" />
            Delete
          </Button>
        </div>
      </div>

      {kata && (
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["expect", "What we expect"],
              ["result", "What happened"],
              ["learned", "What we learned"],
            ] as const
          ).map(([field, name]) => (
            <div key={field} className="min-w-0">
              <FieldLabel htmlFor={`${rowId}-${field}`}>{name}</FieldLabel>
              <BlurTextarea
                id={`${rowId}-${field}`}
                rows={2}
                value={step[field] ?? ""}
                maxLength={TOOL_TEXT_MAX.text}
                onCommit={(text) => patch({ [field]: text })}
              />
            </div>
          ))}
          <div className="min-w-0">
            <FieldLabel htmlFor={`${rowId}-obstacle`}>Works on</FieldLabel>
            <select
              id={`${rowId}-obstacle`}
              value={step.obstacleId ?? ""}
              onChange={(e) => patch({ obstacleId: e.target.value })}
              className={SELECT_CLASS}
            >
              <option value="">No obstacle</option>
              {step.obstacleId && !item.obstacles.some((o) => o.id === step.obstacleId) && (
                <option value={step.obstacleId}>An obstacle that was deleted</option>
              )}
              {item.obstacles.map((o) => (
                <option key={o.id} value={o.id}>
                  {short(o.text, 60)}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {!kata && (
        <div className="min-w-0">
          <FieldLabel htmlFor={`${rowId}-expect`}>How you’ll know it worked</FieldLabel>
          <BlurTextarea
            id={`${rowId}-expect`}
            rows={2}
            value={step.expect ?? ""}
            maxLength={TOOL_TEXT_MAX.text}
            placeholder="What you'll look at, and when."
            onCommit={(text) => patch({ expect: text })}
          />
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        {!kata && (
          <PersonField
            label="Owner"
            value={step.owner ?? ""}
            onCommit={(owner) => patch({ owner })}
          />
        )}
        {!kata && (
          <div className="min-w-0">
            <p className="mb-1 text-sm text-text" aria-hidden="true">
              Due
            </p>
            <DayInput
              label={`Due date for ${label.toLowerCase()}`}
              value={step.due ?? ""}
              validate={dayProblem}
              onCommit={(due) => patch({ due })}
            />
          </div>
        )}
        <div className="min-w-0">
          <label htmlFor={`${rowId}-status`} className="mb-1 block text-sm text-text">
            Status
          </label>
          <StatusSelect
            id={`${rowId}-status`}
            value={step.status}
            onChange={(status) => patch({ status })}
          />
        </div>
      </div>

      {(there || error) && (
        <div className="space-y-1">
          {there && (
            <p className="flex items-center gap-1 text-xs font-medium text-success">
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              {there}
            </p>
          )}
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

export function StepList({
  item,
  done,
  actions,
  heading,
  ai,
}: {
  item: Improvement;
  done: StepDone;
  actions: ItemActions;
  heading: string;
  /** Ask Amr's button and its suggestions, above the add form. */
  ai?: ReactNode;
}) {
  const listId = useId();
  const kata = item.method === "kata";
  const working = item.obstacles.find((o) => o.status === "working");
  const [addError, setAddError] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const rowId = (id: string) => `${listId}-step-${id}`;
  const full = item.steps.length >= TOOL_LIST_MAX.improveSteps;

  const form = useItemForm({
    initial: (): StepDraft => ({
      text: "",
      owner: "",
      due: "",
      expect: "",
      obstacleId: working?.id ?? "",
    }),
    validate: validateStepDraft,
    resetOnSave: false,
    onSave: (values) => {
      const why = actions.addStep({
        text: values.text,
        ...(kata
          ? {
              expect: values.expect,
              ...(values.obstacleId ? { obstacleId: values.obstacleId } : {}),
            }
          : { owner: values.owner, due: values.due }),
      });
      setAddError(why);
      if (!why) {
        form.reset();
        setFocusId(ADD);
      }
    },
  });
  const { draft, update, errors } = form;

  // After an add or a delete, focus goes to the next row (or the add form's first field).
  useEffect(() => {
    if (!focusId) return;
    const target =
      focusId === ADD
        ? form.formRef.current?.querySelector<HTMLElement>("input, textarea")
        : document.getElementById(focusId);
    target?.focus();
    setFocusId(null);
  }, [focusId, form.formRef]);

  const remove = (step: ImprovementStep, at: number) => {
    const next = item.steps[at + 1] ?? item.steps[at - 1];
    actions.removeStep(step);
    setFocusId(next ? `${rowId(next.id)}-text` : ADD);
  };

  return (
    <section aria-labelledby={`${listId}-heading`} className="space-y-3">
      <h3 id={`${listId}-heading`} className="text-sm font-semibold text-text">
        {heading}
      </h3>
      {item.steps.length === 0 ? (
        <p className="text-sm text-sub">
          {kata
            ? "No experiment yet. Plan the first one below: what you'll try, and what you expect."
            : "Nothing yet. Add what you'll change below, each with an owner and a date."}
        </p>
      ) : (
        <ol className="space-y-2">
          {item.steps.map((step, i) => (
            <StepRow
              key={step.id}
              item={item}
              step={step}
              index={i}
              rowId={rowId(step.id)}
              done={done}
              actions={actions}
              onDelete={() => remove(step, i)}
            />
          ))}
        </ol>
      )}
      {ai}
      {full ? (
        <p className="text-sm text-sub">
          This list holds {TOOL_LIST_MAX.improveSteps} at most. Remove one to add another.
        </p>
      ) : (
        <ItemForm
          form={form}
          submitLabel={kata ? "Add experiment" : "Add countermeasure"}
          submitIcon={<Plus aria-hidden="true" />}
          className="rounded-lg border border-dashed border-border p-3"
        >
          <Field
            label={kata ? "What you'll try" : "What you'll change"}
            error={errors.text}
            required
          >
            {(props) => (
              <Input
                {...props}
                value={draft.text}
                maxLength={TOOL_TEXT_MAX.text}
                onChange={(e) => update({ text: e.target.value })}
              />
            )}
          </Field>
          {kata ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="What you expect" error={errors.expect} hint="Needed before it runs.">
                {(props) => (
                  <Textarea
                    {...props}
                    rows={2}
                    value={draft.expect}
                    maxLength={TOOL_TEXT_MAX.text}
                    onChange={(e) => update({ expect: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Works on">
                {(props) => (
                  <select
                    {...props}
                    value={draft.obstacleId}
                    onChange={(e) => update({ obstacleId: e.target.value })}
                    className={SELECT_CLASS}
                  >
                    <option value="">No obstacle</option>
                    {item.obstacles.map((o) => (
                      <option key={o.id} value={o.id}>
                        {short(o.text, 60)}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <PersonPicker
                label="Owner"
                value={draft.owner}
                onChange={(owner) => update({ owner: owner.slice(0, TOOL_TEXT_MAX.short) })}
              />
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
          )}
          {addError && (
            <p role="alert" className="text-xs text-danger">
              {addError}
            </p>
          )}
        </ItemForm>
      )}
    </section>
  );
}
