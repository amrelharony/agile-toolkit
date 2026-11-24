"use client";

import { forwardRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Check, CircleHelp, ListChecks, Pencil, Plus, Trash2, Undo2 } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { InlineItemEditor, useInlineEdit } from "@/components/shared/inline-item-editor";
import { PersonPicker } from "@/components/team/person-picker";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ANSWER_MAX,
  CARD_TEXT_MAX,
  GWT_MAX,
  QUESTION_STATUS_LABEL,
  isStructured,
  validateAnswerDraft,
  validateCardText,
  type AnswerDraft,
} from "@/lib/example-mapping/model";
import type {
  ExampleMapExample,
  ExampleMapQuestion,
  ExampleMapRule,
} from "@/lib/stores/workspace-types";
import {
  EMPTY_GWT_DRAFT,
  GWT_PARTS,
  validateGwtDraft,
  type GwtDraft,
  type GwtPart,
} from "@/lib/stories/fields";
import { cn } from "@/lib/utils";

export const SELECT_CLASS =
  "flex h-11 pointer-fine:md:h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-base pointer-fine:md:text-sm text-text shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const GWT_LABEL: Record<GwtPart, string> = { given: "Given", when: "When", then: "Then" };

/* ── Capture: Enter adds a card ──────────────────────────────────────── */

type CardWhat = "rule" | "example" | "question";

/**
 * One line that adds a card on Enter: a rule, an example under a rule, or
 * (with `children` for the owner and rule fields) a question. Nothing is
 * added blank. A full map says why instead of offering the field.
 */
export const CaptureLine = forwardRef<
  HTMLInputElement,
  {
    what: CardWhat;
    label: string;
    placeholder: string;
    onAdd: (text: string) => void;
    /** Why nothing can be added now (the map is full), or null. */
    fullReason?: string | null;
    submitLabel?: string;
    hideLabel?: boolean;
    className?: string;
  }
>(function CaptureLine(
  { what, label, placeholder, onAdd, fullReason, submitLabel, hideLabel, className },
  ref
) {
  const form = useItemForm<{ text: string }, { text: string }, "text">({
    initial: { text: "" },
    validate: (d) => validateCardText(d.text, what),
    onSave: (v) => onAdd(v.text),
  });
  if (fullReason) return <p className={cn("text-xs text-sub", className)}>{fullReason}</p>;
  return (
    <ItemForm
      form={form}
      submitLabel={submitLabel ?? `Add ${what}`}
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
      className={className}
    >
      <Field label={label} error={form.errors.text} hideLabel={hideLabel}>
        {(props) => (
          <Input
            {...props}
            ref={ref}
            value={form.draft.text}
            maxLength={CARD_TEXT_MAX}
            enterKeyHint="done"
            autoComplete="off"
            placeholder={placeholder}
            onChange={(e) => form.update({ text: e.target.value })}
          />
        )}
      </Field>
    </ItemForm>
  );
});

/* ── The question form ───────────────────────────────────────────────── */

export interface QuestionValues {
  text: string;
  owner: string;
  ruleId: string;
}

/** A new question: its line, who finds the answer, and the rule it is about. */
export function QuestionForm({
  rules,
  onAdd,
  fullReason,
  offerAddToRoster,
}: {
  rules: readonly ExampleMapRule[];
  onAdd: (v: QuestionValues) => void;
  fullReason: string | null;
  offerAddToRoster: boolean;
}) {
  const form = useItemForm<QuestionValues, QuestionValues, "text">({
    initial: { text: "", owner: "", ruleId: "" },
    validate: (d) => {
      const r = validateCardText(d.text, "question");
      return r.ok ? { ok: true, values: { ...d, text: r.values.text } } : r;
    },
    onSave: onAdd,
  });
  if (fullReason) return <p className="text-xs text-sub">{fullReason}</p>;
  const { draft, update, errors } = form;
  return (
    <ItemForm
      form={form}
      submitLabel="Add question"
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
    >
      <Field label="A question nobody can answer yet" error={errors.text}>
        {(props) => (
          <Input
            {...props}
            value={draft.text}
            maxLength={CARD_TEXT_MAX}
            enterKeyHint="done"
            autoComplete="off"
            placeholder="e.g. Can a business account share one card?"
            onChange={(e) => update({ text: e.target.value })}
          />
        )}
      </Field>
      {/* Two columns only when the form itself is wide (a container query): the
          desktop Questions column is narrow, and a select there was cut short. */}
      <div className="@container">
        <div className="grid grid-cols-1 gap-3 @md:grid-cols-2">
          <PersonPicker
            label="Who finds out"
            value={draft.owner}
            onChange={(owner) => update({ owner })}
            placeholder="An owner"
            offerAddToRoster={offerAddToRoster}
          />
          {rules.length > 0 && (
            <Field label="About the rule">
              {(props) => (
                <select
                  {...props}
                  className={SELECT_CLASS}
                  value={draft.ruleId}
                  onChange={(e) => update({ ruleId: e.target.value })}
                >
                  <option value="">No rule in particular</option>
                  {rules.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.text}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
        </div>
      </div>
    </ItemForm>
  );
}

/* ── An editable line ────────────────────────────────────────────────── */

/** A card's text: press it to edit in place (Enter saves, Escape cancels). */
function EditableText({
  text,
  label,
  onSave,
  readOnly,
  className,
}: {
  text: string;
  /** "Rule", "Example", "Question": names the field. */
  label: string;
  onSave: (next: string) => void;
  readOnly?: boolean;
  className?: string;
}) {
  const edit = useInlineEdit<HTMLButtonElement>();
  if (edit.editing) {
    return (
      <InlineItemEditor
        label={`Edit ${label.toLowerCase()}`}
        title={text}
        titleLabel={`${label} text`}
        titleMaxLength={CARD_TEXT_MAX}
        onDone={(next, { refocus }) => {
          if (next) onSave(next.title);
          edit.stop({ refocus });
        }}
      />
    );
  }
  if (readOnly) return <p className={cn("text-sm text-text", className)}>{text}</p>;
  return (
    <button
      ref={edit.triggerRef}
      type="button"
      onClick={edit.start}
      className={cn(
        "min-touch-coarse block w-full rounded text-left text-sm text-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        className
      )}
      aria-label={`${text}. Edit this ${label.toLowerCase()}`}
    >
      {text}
    </button>
  );
}

/* ── Rule card ───────────────────────────────────────────────────────── */

export function RuleCard({
  rule,
  index,
  split,
  children,
  actions,
  onEdit,
  onDelete,
}: {
  rule: ExampleMapRule;
  index: number;
  /** The story "Split by rule" made from it, while it exists. */
  split?: { href: string } | null;
  /** Its examples and their capture. */
  children: ReactNode;
  /** Ask Amr for examples. */
  actions?: ReactNode;
  onEdit: (text: string) => void;
  onDelete: () => void;
}) {
  return (
    <li
      className="flex min-w-0 flex-col gap-2 rounded-lg border border-info/40 bg-info/10 p-3"
      data-rule-id={rule.id}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 text-xs font-semibold text-info">Rule {index + 1}</span>
        <EditableText text={rule.text} label="Rule" onSave={onEdit} className="font-medium" />
        <IconButton
          label={`Delete the rule “${rule.text}” and its examples`}
          icon={<Trash2 aria-hidden="true" />}
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={onDelete}
        />
      </div>
      {split && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-sub">
          <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" />
          Split already: a story of its own.
          <Link
            href={split.href}
            className="min-touch-coarse inline-flex items-center rounded text-accent underline-offset-2 hover:underline"
          >
            Open
          </Link>
        </p>
      )}
      {children}
      {actions}
    </li>
  );
}

/* ── Example card ────────────────────────────────────────────────────── */

/**
 * A green card under a rule. "Write as Given, When, Then" opens the three
 * parts (each needed, each at most 1,000 characters); a structured example
 * shows them under its line.
 */
export function ExampleCard({
  example,
  onEdit,
  onGwt,
  onDelete,
}: {
  example: ExampleMapExample;
  onEdit: (text: string) => void;
  /** Save the three parts (null takes them off). */
  onGwt: (gwt: GwtDraft | null) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const structured = isStructured(example);
  return (
    <li
      className="flex min-w-0 flex-col gap-1.5 rounded-md border border-success/40 bg-success/10 p-2"
      data-example-id={example.id}
    >
      <div className="flex items-start gap-2">
        <EditableText text={example.text} label="Example" onSave={onEdit} />
        <IconButton
          label={`Delete the example “${example.text}”`}
          icon={<Trash2 aria-hidden="true" />}
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={onDelete}
        />
      </div>
      {structured && !open && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-xs text-sub">
          {GWT_PARTS.map((p) => (
            <div key={p} className="contents">
              <dt className="font-semibold text-text">{GWT_LABEL[p]}</dt>
              <dd className="min-w-0 break-words">{example[p]}</dd>
            </div>
          ))}
        </dl>
      )}
      {open ? (
        <GwtForm
          initial={
            structured
              ? { given: example.given ?? "", when: example.when ?? "", then: example.then ?? "" }
              : EMPTY_GWT_DRAFT
          }
          onSave={(d) => {
            onGwt(d);
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
          onClear={
            structured
              ? () => {
                  onGwt(null);
                  setOpen(false);
                }
              : undefined
          }
        />
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start"
          aria-expanded={false}
          onClick={() => setOpen(true)}
        >
          <ListChecks aria-hidden="true" />
          {structured ? "Edit Given, When, Then" : "Write as Given, When, Then"}
          <span className="sr-only">: {example.text}</span>
        </Button>
      )}
    </li>
  );
}

function GwtForm({
  initial,
  onSave,
  onCancel,
  onClear,
}: {
  initial: GwtDraft;
  onSave: (d: GwtDraft) => void;
  onCancel: () => void;
  onClear?: () => void;
}) {
  const form = useItemForm<GwtDraft, GwtDraft, GwtPart>({
    initial,
    validate: validateGwtDraft,
    onSave,
    resetOnSave: false,
  });
  return (
    <ItemForm
      form={form}
      submitLabel="Save Given, When, Then"
      onCancel={onCancel}
      footer={
        onClear && (
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            <Undo2 aria-hidden="true" />
            Keep it as a line
          </Button>
        )
      }
    >
      {GWT_PARTS.map((p) => (
        <Field key={p} label={GWT_LABEL[p]} error={form.errors[p]} required>
          {(props) => (
            <Textarea
              {...props}
              rows={2}
              value={form.draft[p]}
              maxLength={GWT_MAX}
              onChange={(e) => form.update({ [p]: e.target.value } as Partial<GwtDraft>)}
            />
          )}
        </Field>
      ))}
    </ItemForm>
  );
}

/* ── Question card ───────────────────────────────────────────────────── */

export function QuestionCard({
  question,
  ruleText,
  onEdit,
  onAnswer,
  onStatus,
  onMakeRule,
  makeRuleBlocked,
  onDelete,
}: {
  question: ExampleMapQuestion;
  ruleText?: string;
  onEdit: (text: string) => void;
  onAnswer: (answer: string) => void;
  onStatus: (status: ExampleMapQuestion["status"]) => void;
  onMakeRule: () => void;
  /** Why "Make it a rule" can't run (the map is full), or null. */
  makeRuleBlocked: string | null;
  onDelete: () => void;
}) {
  const [answering, setAnswering] = useState(false);
  const form = useItemForm<AnswerDraft, { answer: string }, "answer">({
    initial: () => ({ answer: question.answer ?? "" }),
    validate: validateAnswerDraft,
    onSave: (v) => {
      onAnswer(v.answer);
      setAnswering(false);
    },
    resetOnSave: false,
  });
  const open = question.status === "open";
  return (
    <li
      className={cn(
        "flex min-w-0 flex-col gap-1.5 rounded-md border p-2",
        open ? "border-danger/40 bg-danger/10" : "border-border bg-card"
      )}
      data-question-id={question.id}
    >
      <div className="flex items-start gap-2">
        <CircleHelp
          className={cn("mt-0.5 h-4 w-4 shrink-0", open ? "text-danger" : "text-sub")}
          aria-hidden="true"
        />
        <EditableText text={question.text} label="Question" onSave={onEdit} />
        <IconButton
          label={`Delete the question “${question.text}”`}
          icon={<Trash2 aria-hidden="true" />}
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={onDelete}
        />
      </div>
      <p className="text-xs text-sub">
        {QUESTION_STATUS_LABEL[question.status]}
        {question.owner ? ` · ${question.owner} finds out` : ""}
        {ruleText ? ` · about “${ruleText}”` : ""}
      </p>
      {question.answer && !answering && (
        <p className="whitespace-pre-line text-sm text-text">
          <span className="font-semibold">Answer: </span>
          {question.answer}
        </p>
      )}
      {answering ? (
        <ItemForm
          form={form}
          submitLabel="Save the answer"
          onCancel={() => {
            form.reset({ answer: question.answer ?? "" });
            setAnswering(false);
          }}
        >
          <Field label="Answer" error={form.errors.answer} required>
            {(props) => (
              <Textarea
                {...props}
                rows={2}
                value={form.draft.answer}
                maxLength={ANSWER_MAX}
                onChange={(e) => form.update({ answer: e.target.value })}
              />
            )}
          </Field>
        </ItemForm>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setAnswering(true)}>
            <Pencil aria-hidden="true" />
            {question.answer ? "Change the answer" : "Answer it"}
            <span className="sr-only">: {question.text}</span>
          </Button>
          {open ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => onStatus("dropped")}>
              Drop it<span className="sr-only">: {question.text}</span>
            </Button>
          ) : (
            <Button type="button" variant="ghost" size="sm" onClick={() => onStatus("open")}>
              Open it again<span className="sr-only">: {question.text}</span>
            </Button>
          )}
          {question.status === "answered" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onMakeRule}
              disabled={Boolean(makeRuleBlocked)}
              title={makeRuleBlocked ?? undefined}
            >
              Make it a rule<span className="sr-only">: {question.text}</span>
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
