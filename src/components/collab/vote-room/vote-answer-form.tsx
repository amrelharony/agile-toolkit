"use client";

/**
 * A participant's answers to one round: a scale per question, nothing
 * picked to start with, so nobody's answer is a default.
 *
 * The draft lives in this component only. It is never stored, and it is
 * cleared once the answers are sent. Required questions must be answered
 * (inline errors, focus on the first one); optional ones can stay blank,
 * and say so in their name. Enter on a scale sends the form; Space and the
 * arrow keys pick. Callers key it by round id, so every round starts blank
 * even when its questions are the same.
 */

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScalePicker, focusFirstInvalid } from "@/components/shared/scale-picker";
import type { AnswerDraft, Questionnaire } from "@/lib/realtime/vote-room/protocol";
import type { VoteSubmitResult } from "@/lib/realtime/vote-room/use-vote-room";

export interface VoteAnswerFormProps {
  questionnaire: Questionnaire;
  onSubmit: (draft: AnswerDraft) => Promise<VoteSubmitResult>;
  /** Why answering is off right now (shown, and the button is disabled). */
  disabledReason?: string | null;
  /** The send button's label. */
  submitLabel?: string;
}

const REQUIRED_ERROR = "Pick an answer.";

function emptyDraft(q: Questionnaire): AnswerDraft {
  return Object.fromEntries(q.questions.map((x) => [x.id, null]));
}

/** What a refused send means for the person, or null when it went. */
export function submitError(result: VoteSubmitResult): string | null {
  switch (result) {
    case "sent":
      return null;
    case "incomplete":
      return "Answer every question that isn't optional.";
    case "already-answered":
      return "You've already answered this round.";
    case "not-admitted":
      return "The room is full, so your answers can't be counted.";
    case "closed":
      return "This round has closed.";
    default:
      return "Couldn't send your answers. Try again.";
  }
}

export function VoteAnswerForm({
  questionnaire,
  onSubmit,
  disabledReason = null,
  submitLabel = "Send answers",
}: VoteAnswerFormProps) {
  const [draft, setDraft] = useState<AnswerDraft>(() => emptyDraft(questionnaire));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [focusPending, setFocusPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const errorId = useId();

  // A new questionnaire (a new round) starts blank.
  const signature = questionnaire.questions.map((x) => x.id).join("|") + questionnaire.id;
  useEffect(() => {
    setDraft(emptyDraft(questionnaire));
    setErrors({});
    setFormError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  // After a failed send, focus the first question still missing an answer.
  useEffect(() => {
    if (!focusPending) return;
    setFocusPending(false);
    focusFirstInvalid(formRef.current);
  }, [focusPending]);

  const send = async () => {
    if (sending || disabledReason) return;
    const nextErrors: Record<string, string> = {};
    for (const q of questionnaire.questions) {
      if (q.optional !== true && draft[q.id] === null) nextErrors[q.id] = REQUIRED_ERROR;
    }
    const answeredAny = questionnaire.questions.some((q) => draft[q.id] !== null);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setFormError(null);
      setFocusPending(true);
      return;
    }
    if (!answeredAny) {
      setFormError("Answer at least one question.");
      return;
    }
    setSending(true);
    const result = await onSubmit(draft);
    setSending(false);
    if (result === "sent") {
      // Nothing of the answers stays in this browser.
      setDraft(emptyDraft(questionnaire));
      setFormError(null);
      return;
    }
    setFormError(submitError(result));
  };

  const onFormSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void send();
  };

  // The scales are buttons: Enter would pick, so make it send instead.
  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key !== "Enter" || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement;
    if (target.getAttribute("role") === "radio") {
      e.preventDefault();
      void send();
    }
  };

  const steps = questionnaire.scale.points.map((p) => ({ value: p.value }));
  const labelFor = (v: number) =>
    questionnaire.scale.points.find((p) => p.value === v)?.label ?? String(v);

  return (
    // Enter on a scale is a shortcut on top of the visible Send button.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <form
      ref={formRef}
      onSubmit={onFormSubmit}
      onKeyDown={onKeyDown}
      noValidate
      aria-describedby={formError ? errorId : undefined}
      className="space-y-4"
    >
      <ol className="space-y-4">
        {questionnaire.questions.map((q, i) => (
          <li key={q.id} className="rounded-lg border border-border bg-card p-3">
            <ScalePicker
              // The radio group's name: "optional" is part of what a screen reader hears.
              label={`${i + 1}. ${q.text}${q.optional === true ? " (optional)" : ""}`}
              steps={steps}
              format={labelFor}
              value={draft[q.id] ?? null}
              onValueChange={(v) => {
                setDraft((d) => ({ ...d, [q.id]: v }));
                if (errors[q.id]) {
                  setErrors((prev) => {
                    const next = { ...prev };
                    delete next[q.id];
                    return next;
                  });
                }
                setFormError(null);
              }}
              onClear={
                q.optional === true ? () => setDraft((d) => ({ ...d, [q.id]: null })) : undefined
              }
              hint={
                [q.hint, q.optional === true ? "Leave it blank to skip." : null]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              error={errors[q.id]}
              optionsClassName="flex-wrap"
            />
          </li>
        ))}
      </ol>
      {formError && (
        <p id={errorId} className="text-sm text-danger" role="alert">
          {formError}
        </p>
      )}
      {disabledReason && !formError && <p className="text-sm text-sub">{disabledReason}</p>}
      <Button
        type="submit"
        variant="toolkit"
        className="gap-1.5"
        disabled={sending || Boolean(disabledReason)}
      >
        <Send className="h-4 w-4" aria-hidden="true" />
        {sending ? "Sending…" : submitLabel}
      </Button>
    </form>
  );
}
