"use client";

/**
 * A participant's answers to a pair round (Kano): for each item, the same
 * two questions ("If it has this, how do you feel?" / "If it doesn't?"),
 * each a pick on the round's short scale. Nothing is picked to start with,
 * so nobody's answer is a default.
 *
 * The two answers about one item belong together (the host counts the
 * pair, never each answer alone), so an item is answered whole or not at
 * all: a required item needs both, an optional one both or neither ("Answer
 * both, or leave both blank to skip."). Errors show inline on the missing
 * half, focus goes to the first, and Enter on a scale sends. The draft
 * lives here only and is cleared once sent. Callers key it by round id.
 *
 * Every item asks the same two questions, so each scale's accessible name
 * carries its item ("Dark mode: If it has this, how do you feel?"), and so
 * does its Clear button: a screen reader moving between controls (or
 * VoiceOver on iOS, which reads legends unreliably) hears which feature it
 * is on. The visible label stays the question alone.
 */

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { focusFirstInvalid } from "@/lib/utils/form";
import {
  pairDraftKey,
  pairItemProblem,
  type PairDraft,
  type PairSheet,
} from "@/lib/realtime/vote-room/pair";
import type { VoteSubmitResult } from "@/lib/realtime/vote-room/use-vote-room";
import { submitError } from "./vote-answer-form";

export interface PairAnswerFormProps {
  sheet: PairSheet;
  onSubmit: (draft: PairDraft) => Promise<VoteSubmitResult>;
  /** Why answering is off right now (shown, and the button is disabled). */
  disabledReason?: string | null;
  /** The send button's label. */
  submitLabel?: string;
}

const REQUIRED_ERROR = "Pick an answer.";
const HALF_ERROR = "Answer both, or leave both blank to skip.";

function emptyDraft(sheet: PairSheet): PairDraft {
  const out: PairDraft = {};
  for (const item of sheet.items) {
    out[pairDraftKey(item.id, "first")] = null;
    out[pairDraftKey(item.id, "second")] = null;
  }
  return out;
}

/**
 * One of an item's two questions as a segmented control. Like the shared
 * `ScalePicker` (radio semantics, one tab stop, `data-scale-invalid` for
 * `focusFirstInvalid`, the error describing the group), except that the
 * group is named `name` while the visible label is `label`: ScalePicker
 * names the group by its visible label, which is the same for every item.
 */
function PairQuestion({
  name,
  label,
  answers,
  value,
  onValueChange,
  onClear,
  error,
}: {
  /** The group's accessible name: the item and the question. */
  name: string;
  /** The visible label: the question. */
  label: string;
  answers: readonly string[];
  value: number | null;
  onValueChange: (value: number) => void;
  /** Offer "Clear" while an answer is picked (optional items only). */
  onClear?: () => void;
  error?: string;
}) {
  const id = useId();
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-scale-invalid={error ? "true" : undefined}>
      <div className="flex min-h-6 items-center justify-between gap-2">
        {/* The radio group carries `name`; this is the visible label. */}
        <span className="text-sm text-text" aria-hidden="true">
          {label}
        </span>
        {onClear && value !== null && (
          <button
            type="button"
            onClick={onClear}
            aria-label={`Clear ${name}`}
            className="min-touch-coarse rounded text-xs text-sub underline-offset-2 hover:text-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Clear
          </button>
        )}
      </div>
      <ToggleGroup
        label={name}
        className="flex-wrap"
        options={answers.map((a, i) => ({ value: i, label: a }))}
        value={value}
        onValueChange={onValueChange}
        aria-describedby={errorId}
      />
      {error && (
        <p id={errorId} className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function PairAnswerForm({
  sheet,
  onSubmit,
  disabledReason = null,
  submitLabel = "Send answers",
}: PairAnswerFormProps) {
  const [draft, setDraft] = useState<PairDraft>(() => emptyDraft(sheet));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [focusPending, setFocusPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const errorId = useId();
  const points = sheet.answers.length;

  // A new sheet (a new round) starts blank.
  const signature = `${sheet.id}|${sheet.answers.join("|")}|${sheet.items.map((x) => x.id).join("|")}`;
  useEffect(() => {
    setDraft(emptyDraft(sheet));
    setErrors({});
    setFormError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  useEffect(() => {
    if (!focusPending) return;
    setFocusPending(false);
    focusFirstInvalid(formRef.current);
  }, [focusPending]);

  const pick = (key: string, value: number | null) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((prev) => {
      // Picking one half settles that half; a half-answered pair is re-checked on send.
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setFormError(null);
  };

  const send = async () => {
    if (sending || disabledReason) return;
    const nextErrors: Record<string, string> = {};
    let answered = 0;
    for (const item of sheet.items) {
      const first = pairDraftKey(item.id, "first");
      const second = pairDraftKey(item.id, "second");
      const problem = pairItemProblem(draft, item, points);
      if (problem === "half" || problem === "missing" || problem === "off-scale") {
        const message = problem === "half" && item.optional === true ? HALF_ERROR : REQUIRED_ERROR;
        if (draft[first] === null || problem === "off-scale") nextErrors[first] = message;
        if (draft[second] === null || problem === "off-scale") nextErrors[second] = message;
      } else if (draft[first] !== null) {
        answered++;
      }
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setFormError(null);
      setFocusPending(true);
      return;
    }
    if (answered === 0) {
      setFormError("Answer at least one item.");
      return;
    }
    setSending(true);
    const result = await onSubmit(draft);
    setSending(false);
    if (result === "sent") {
      // Nothing of the answers stays in this browser.
      setDraft(emptyDraft(sheet));
      setFormError(null);
      return;
    }
    setFormError(
      result === "incomplete"
        ? "Answer both questions for every item that isn't optional."
        : submitError(result)
    );
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
        {sheet.items.map((item, i) => {
          const first = pairDraftKey(item.id, "first");
          const second = pairDraftKey(item.id, "second");
          // Only an optional item's answers can go back to blank.
          const clear = (key: string) =>
            item.optional === true ? () => pick(key, null) : undefined;
          return (
            <li key={item.id}>
              <fieldset className="space-y-3 rounded-lg border border-border bg-card p-3">
                <legend className="px-1 text-sm font-medium text-text">
                  {i + 1}. {item.text}
                  {/* A real space, so the group's name reads "… (optional)". */}
                  {item.optional === true && (
                    <>
                      {" "}
                      <span className="text-xs text-sub">(optional)</span>
                    </>
                  )}
                </legend>
                {(item.hint || item.optional === true) && (
                  <p className="text-xs text-sub">
                    {[item.hint, item.optional === true ? "Leave both blank to skip." : null]
                      .filter(Boolean)
                      .join(" ")}
                  </p>
                )}
                <PairQuestion
                  name={`${item.text}: ${sheet.prompts.first}`}
                  label={sheet.prompts.first}
                  answers={sheet.answers}
                  value={draft[first] ?? null}
                  onValueChange={(v) => pick(first, v)}
                  onClear={clear(first)}
                  error={errors[first]}
                />
                <PairQuestion
                  name={`${item.text}: ${sheet.prompts.second}`}
                  label={sheet.prompts.second}
                  answers={sheet.answers}
                  value={draft[second] ?? null}
                  onValueChange={(v) => pick(second, v)}
                  onClear={clear(second)}
                  error={errors[second]}
                />
              </fieldset>
            </li>
          );
        })}
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
