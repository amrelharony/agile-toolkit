"use client";

/**
 * A participant's answer to a choice round (Quick Vote's polls, multi-picks
 * and dot voting). Nothing is picked to start with, so nobody's answer is a
 * default.
 *
 *  - single: one radio button per option;
 *  - multi: one checkbox per option, up to the round's limit (the rest turn
 *    off once it is reached, and say so);
 *  - dots: a − / + stepper per option, with "N dots left" in a bar stuck to
 *    the bottom of the screen beside Send, so it stays in sight on a phone.
 *
 * Every option is a whole-width row, so the tap target is the row, not the
 * small box. The draft lives in this component only, is never stored, and
 * is cleared once sent. Callers key it by round id.
 */

import { useEffect, useId, useState, type FormEvent } from "react";
import { Minus, Plus, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  choiceDraftProblem,
  type ChoiceDraft,
  type ChoiceSheet,
} from "@/lib/realtime/vote-room/choice";
import type { VoteSubmitResult } from "@/lib/realtime/vote-room/use-vote-room";
import { submitError } from "./vote-answer-form";

export interface ChoiceAnswerFormProps {
  sheet: ChoiceSheet;
  onSubmit: (draft: ChoiceDraft) => Promise<VoteSubmitResult>;
  /** Why answering is off right now (shown, and the button is disabled). */
  disabledReason?: string | null;
  submitLabel?: string;
}

function blank(sheet: ChoiceSheet): Record<string, number> {
  return Object.fromEntries(sheet.options.map((x) => [x.id, 0]));
}

function dotsWord(n: number): string {
  return `${n} ${n === 1 ? "dot" : "dots"}`;
}

/** What the person is asked to do, in one line. */
export function choiceInstruction(sheet: ChoiceSheet): string {
  if (sheet.mode === "single") return "Pick one.";
  if (sheet.mode === "multi") {
    return sheet.limit >= sheet.options.length
      ? "Pick as many as you like."
      : `Pick up to ${sheet.limit}.`;
  }
  return `Spread up to ${dotsWord(sheet.limit)}. You can put more than one on an option.`;
}

/** "3 dots left.", "All 5 dots placed." */
export function dotsLeftText(used: number, limit: number): string {
  const left = limit - used;
  return left <= 0 ? `All ${dotsWord(limit)} placed.` : `${dotsWord(left)} left.`;
}

export function ChoiceAnswerForm({
  sheet,
  onSubmit,
  disabledReason = null,
  submitLabel = "Send answer",
}: ChoiceAnswerFormProps) {
  const [counts, setCounts] = useState<Record<string, number>>(() => blank(sheet));
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const errorId = useId();
  const groupId = useId();
  const leftId = useId();

  const signature = `${sheet.id}|${sheet.mode}|${sheet.limit}|${sheet.options.map((x) => x.id).join("|")}`;
  useEffect(() => {
    setCounts(blank(sheet));
    setFormError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const used = sheet.options.reduce((sum, x) => sum + (counts[x.id] ?? 0), 0);
  const full = used >= sheet.limit;

  const set = (id: string, n: number) => {
    setCounts((c) => (sheet.mode === "single" ? { ...blank(sheet), [id]: n } : { ...c, [id]: n }));
    setFormError(null);
  };

  const send = async () => {
    if (sending || disabledReason) return;
    const draft: ChoiceDraft = { ...counts };
    const problem = choiceDraftProblem(draft, sheet);
    if (problem) {
      setFormError(
        problem.problem === "empty"
          ? sheet.mode === "dots"
            ? "Place at least one dot."
            : sheet.mode === "single"
              ? "Pick an option."
              : "Pick at least one option."
          : sheet.mode === "dots"
            ? `You have ${dotsWord(sheet.limit)} at most.`
            : `Pick up to ${sheet.limit}.`
      );
      return;
    }
    setSending(true);
    const result = await onSubmit(draft);
    setSending(false);
    if (result === "sent") {
      // Nothing of the answer stays in this browser.
      setCounts(blank(sheet));
      setFormError(null);
      return;
    }
    setFormError(submitError(result));
  };

  const onFormSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void send();
  };

  const footer = (
    <>
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
        aria-describedby={sheet.mode === "dots" ? leftId : undefined}
      >
        <Send className="h-4 w-4" aria-hidden="true" />
        {sending ? "Sending…" : submitLabel}
      </Button>
    </>
  );

  return (
    <form
      onSubmit={onFormSubmit}
      noValidate
      aria-describedby={formError ? errorId : undefined}
      className="space-y-4"
    >
      <fieldset className="min-w-0 space-y-2" aria-describedby={`${groupId}-how`}>
        {/* The page's heading shows the question; the group still needs its name. */}
        <legend className="sr-only">{sheet.title}</legend>
        <p id={`${groupId}-how`} className="text-sm text-sub">
          {choiceInstruction(sheet)}
        </p>
        <ul className="space-y-2">
          {sheet.options.map((option) => {
            const n = counts[option.id] ?? 0;
            const hintId = option.hint ? `${groupId}-${option.id}-hint` : undefined;
            if (sheet.mode === "dots") {
              return (
                <li
                  key={option.id}
                  className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-card p-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm text-text">{option.text}</p>
                    {option.hint && (
                      <p id={hintId} className="text-xs text-sub">
                        {option.hint}
                      </p>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={`One dot fewer on ${option.text}`}
                    disabled={n === 0}
                    onClick={() => set(option.id, n - 1)}
                  >
                    <Minus aria-hidden="true" />
                  </Button>
                  <output
                    className="w-8 text-center font-data text-base text-text"
                    aria-label={`${dotsWord(n)} on ${option.text}`}
                  >
                    {n}
                  </output>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={`One more dot on ${option.text}`}
                    disabled={full || n >= sheet.limit}
                    onClick={() => set(option.id, n + 1)}
                  >
                    <Plus aria-hidden="true" />
                  </Button>
                </li>
              );
            }
            const single = sheet.mode === "single";
            const off = !single && n === 0 && full;
            return (
              <li key={option.id}>
                <label
                  className={cn(
                    "flex min-h-11 min-w-0 cursor-pointer items-start gap-3 rounded-lg border border-border bg-card px-3 py-2.5",
                    n > 0 && "border-accent",
                    off && "cursor-not-allowed opacity-60"
                  )}
                >
                  <input
                    type={single ? "radio" : "checkbox"}
                    name={single ? groupId : undefined}
                    className="mt-1 h-4 w-4 shrink-0"
                    checked={n > 0}
                    disabled={off}
                    aria-describedby={hintId}
                    onChange={(e) => set(option.id, e.target.checked ? 1 : 0)}
                  />
                  <span className="min-w-0">
                    <span className="block break-words text-sm text-text">{option.text}</span>
                    {option.hint && (
                      <span id={hintId} className="block text-xs text-sub">
                        {option.hint}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        {sheet.mode === "multi" && full && sheet.limit < sheet.options.length && (
          <p className="text-xs text-sub">
            You&apos;ve picked {sheet.limit}. Untick one to pick another.
          </p>
        )}
      </fieldset>
      {sheet.mode === "dots" ? (
        <div className="sticky bottom-[var(--amr-band-bottom,0px)] z-10 space-y-2 border-t border-border bg-card pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <p id={leftId} className="text-sm font-medium text-text" aria-live="polite">
            {dotsLeftText(used, sheet.limit)}
          </p>
          {footer}
        </div>
      ) : (
        <div className="space-y-2">{footer}</div>
      )}
    </form>
  );
}
