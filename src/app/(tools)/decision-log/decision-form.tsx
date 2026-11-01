"use client";

import { useRef } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { PeoplePicker, PersonPicker } from "@/components/team/person-picker";
import type {
  Decision,
  DecisionOption,
  DecisionRole,
  DecisionTemplate,
  TeamMember,
} from "@/lib/stores/workspace-types";
import { DECISION_TEMPLATES } from "@/lib/decisions/model";
import { TEMPLATES } from "@/lib/decisions/templates";
import { findRosterMember } from "@/lib/team/names";
import type { FormErrors, Validation } from "@/lib/utils/form";
import { DECISION_TEXT_MAX, DECISION_TITLE_MAX, NAME_MAX, raisedDayError } from "./view";

export interface DecisionDraft {
  template: DecisionTemplate;
  title: string;
  /** "YYYY-MM-DD" it was raised: today unless backdated. */
  date: string;
  context: string;
  /** One text per option, in order; blank rows are dropped on save. */
  options: string[];
  recommendation: string;
  decider: string;
  /** The template's named roles; a single role holds one name at most. */
  roles: Partial<Record<DecisionRole, string[]>>;
}

/** A new record as the form saves it: everything but its id and number. */
export type NewDecision = Omit<Decision, "id" | "number">;

export type DecisionField =
  | "title"
  | "date"
  | "context"
  | "options"
  | "recommendation"
  | "decider"
  | DecisionRole;

export function emptyDecisionDraft(template: DecisionTemplate, today: string): DecisionDraft {
  return {
    template,
    title: "",
    date: today,
    context: "",
    options: [],
    recommendation: "",
    decider: "",
    roles: {},
  };
}

/** The roster's spelling of a typed name, or the name as typed. */
function rosterName(name: string, roster: readonly TeamMember[]): string {
  const t = name.trim();
  return findRosterMember(roster, t)?.name ?? t;
}

/**
 * Check a draft. The title is required; the day it was raised can be
 * backdated but not set in the future; names and text have length limits.
 * The people are optional here (DACI and RAPID need their decider named
 * before Decide, which says so). Option ids are made from `idFor`, so the
 * caller decides them (the record's id plus the place).
 */
export function validateDecisionDraft(
  d: DecisionDraft,
  {
    today,
    roster = [],
    idFor,
  }: {
    today: string;
    roster?: readonly TeamMember[];
    idFor: (index: number) => string;
  }
): Validation<NewDecision, DecisionField> {
  const errors: FormErrors<DecisionField> = {};
  const title = d.title.trim();
  if (!title) errors.title = "Give the decision a title.";
  else if (title.length > DECISION_TITLE_MAX) {
    errors.title = `Keep the title to ${DECISION_TITLE_MAX} characters.`;
  }
  const day = raisedDayError(d.date, today);
  if (day) errors.date = day;
  if (d.context.trim().length > DECISION_TEXT_MAX) {
    errors.context = `Keep the context to ${DECISION_TEXT_MAX} characters.`;
  }
  if (d.recommendation.trim().length > DECISION_TEXT_MAX) {
    errors.recommendation = `Keep the recommendation to ${DECISION_TEXT_MAX} characters.`;
  }
  const texts = d.options.map((o) => o.trim()).filter(Boolean);
  if (texts.some((t) => t.length > DECISION_TEXT_MAX)) {
    errors.options = `Keep each option to ${DECISION_TEXT_MAX} characters.`;
  } else if (new Set(texts.map((t) => t.toLowerCase())).size !== texts.length) {
    errors.options = "Two options say the same thing: merge them or tell them apart.";
  }
  if (d.decider.trim().length > NAME_MAX) {
    errors.decider = `Keep the name to ${NAME_MAX} characters.`;
  }
  const spec = TEMPLATES[d.template];
  const roles: Partial<Record<DecisionRole, string[]>> = {};
  for (const r of spec.roles) {
    const names = (d.roles[r.role] ?? []).map((n) => rosterName(n, roster)).filter(Boolean);
    if (names.some((n) => n.length > NAME_MAX)) {
      errors[r.role] = `Keep each name to ${NAME_MAX} characters.`;
    }
    if (names.length > 0) roles[r.role] = r.single ? names.slice(0, 1) : names;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const options: DecisionOption[] = texts.map((text, i) => ({ id: idFor(i), text }));
  const context = d.context.trim();
  const recommendation = d.recommendation.trim();
  const decider = d.decider.trim() ? rosterName(d.decider, roster) : "";
  return {
    ok: true,
    values: {
      title,
      ...(context ? { context } : {}),
      decision: "",
      status: "proposed",
      date: d.date,
      template: d.template,
      ...(options.length > 0 ? { options } : {}),
      ...(recommendation && d.template !== "adr" ? { recommendation } : {}),
      ...(decider ? { decider } : {}),
      ...(Object.keys(roles).length > 0 ? { roles } : {}),
    },
  };
}

/** The draft's options: one input per option, with Add and remove. */
function OptionsDraft({
  values,
  onChange,
  error,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  error?: string;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const focusRow = (i: number) =>
    window.setTimeout(() => listRef.current?.querySelectorAll("input")[i]?.focus(), 0);
  const add = () => {
    onChange([...values, ""]);
    focusRow(values.length);
  };
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="text-sm text-text">Options considered</legend>
      {values.length > 0 && (
        <ul ref={listRef} className="space-y-2">
          {values.map((v, i) => (
            <li key={i} className="flex min-w-0 items-center gap-2">
              <Input
                aria-label={`Option ${i + 1}`}
                value={v}
                maxLength={DECISION_TEXT_MAX}
                placeholder={i === 0 ? "e.g. Use the managed service" : "Another option"}
                aria-invalid={error ? true : undefined}
                onChange={(e) => onChange(values.map((x, j) => (j === i ? e.target.value : x)))}
                onKeyDown={(e) => {
                  // Enter adds the next option rather than saving half a list.
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  if (i === values.length - 1) add();
                  else focusRow(i + 1);
                }}
              />
              <IconButton
                label={`Remove option ${i + 1}`}
                icon={<X className="h-4 w-4" />}
                onClick={() => onChange(values.filter((_, j) => j !== i))}
              />
            </li>
          ))}
        </ul>
      )}
      <Button type="button" variant="outline" size="sm" className="gap-1" onClick={add}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        Add an option
      </Button>
      {error && (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/**
 * New decision record: the form (ADR, DACI or RAPID, the route's by
 * default) and what it asks for. Nothing is saved until the title is in
 * and every field passes; the record gets the next number in the log when
 * it is saved.
 */
export function DecisionForm({
  template,
  today,
  roster,
  newId,
  onSave,
  onCancel,
}: {
  template: DecisionTemplate;
  today: string;
  roster: readonly TeamMember[];
  /** The id the record will get, so its options can carry ids made from it. */
  newId: () => string;
  onSave: (id: string, values: NewDecision) => void;
  onCancel?: () => void;
}) {
  // The id the next save uses, fixed per draft so option ids match it.
  const idRef = useRef<string | null>(null);
  const idOfDraft = () => (idRef.current ??= newId());
  const form = useItemForm<DecisionDraft, NewDecision, DecisionField>({
    initial: () => emptyDecisionDraft(template, today),
    validate: (d) =>
      validateDecisionDraft(d, { today, roster, idFor: (i) => `${idOfDraft()}-o${i}` }),
    onSave: (values) => {
      onSave(idOfDraft(), values);
      idRef.current = null;
    },
  });
  const { draft, update, errors } = form;
  const spec = TEMPLATES[draft.template];
  const setRole = (role: DecisionRole, names: string[]) =>
    update({ roles: { ...draft.roles, [role]: names } });

  return (
    <ItemForm
      form={form}
      submitLabel={`Add ${spec.label} record`}
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
      onCancel={onCancel}
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-sm text-text" aria-hidden="true">
          Form
        </span>
        <ToggleGroup
          label="Form"
          size="sm"
          value={draft.template}
          onValueChange={(t) => update({ template: t })}
          options={DECISION_TEMPLATES.map((t) => ({
            value: t,
            label: TEMPLATES[t].label,
            description:
              t === "adr"
                ? "Context, options, outcome and consequences"
                : t === "daci"
                  ? "Adds a Driver, Contributors and Informed around the Approver"
                  : "Adds Recommend, Agree, Perform and Input around the Decide",
          }))}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
        <Field label="Title" required error={errors.title}>
          {(props) => (
            <Input
              {...props}
              value={draft.title}
              maxLength={DECISION_TITLE_MAX}
              placeholder="e.g. Use Postgres for the event log"
              onChange={(e) => update({ title: e.target.value })}
            />
          )}
        </Field>
        <Field label="Raised on" error={errors.date} hint="Backdate it if it started earlier.">
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
      <Field label="Context" error={errors.context} hint="The problem, and the constraints on it.">
        {(props) => (
          <Textarea
            {...props}
            rows={3}
            maxLength={DECISION_TEXT_MAX}
            value={draft.context}
            onChange={(e) => update({ context: e.target.value })}
          />
        )}
      </Field>
      <OptionsDraft
        values={draft.options}
        onChange={(options) => update({ options })}
        error={errors.options}
      />
      {draft.template !== "adr" && (
        <Field
          label="Recommendation"
          error={errors.recommendation}
          hint={
            draft.template === "daci" ? "What the Driver proposes." : "What Recommend (R) proposes."
          }
        >
          {(props) => (
            <Textarea
              {...props}
              rows={2}
              maxLength={DECISION_TEXT_MAX}
              value={draft.recommendation}
              onChange={(e) => update({ recommendation: e.target.value })}
            />
          )}
        </Field>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <PersonPicker
          label={spec.deciderLabel}
          value={draft.decider}
          onChange={(decider) => update({ decider })}
          error={errors.decider}
          hint={
            spec.deciderRequiredToDecide
              ? "The one person with the final say. Needed before it's decided."
              : "The one person with the final say (optional)."
          }
        />
        {spec.roles
          .filter((r) => r.single)
          .map((r) => (
            <PersonPicker
              key={r.role}
              label={r.label}
              value={(draft.roles[r.role] ?? [])[0] ?? ""}
              onChange={(name) => setRole(r.role, name ? [name] : [])}
              error={errors[r.role]}
              hint={r.hint}
            />
          ))}
      </div>
      {spec.roles
        .filter((r) => !r.single)
        .map((r) => (
          <PeoplePicker
            key={r.role}
            label={r.label}
            values={draft.roles[r.role] ?? []}
            onChange={(names) => setRole(r.role, names)}
            error={errors[r.role]}
            hint={r.hint}
          />
        ))}
    </ItemForm>
  );
}
