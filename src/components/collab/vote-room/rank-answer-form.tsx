"use client";

/**
 * A participant's order in a rank round (Quick Vote's ranking). Nothing is
 * in order to start with, so the sheet's own order is nobody's default:
 * the person taps the options in the order they want them (first tap is
 * first place), then can move one up or down, or take it back out.
 *
 * Every control is a button (no dragging), whole-width on a phone, and
 * each move is announced. The draft lives in this component only, is never
 * stored, and is cleared once sent. Callers key it by round id.
 */

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Send, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAnnounce } from "@/components/a11y/live-announcer";
import type { RankDraft, RankSheet } from "@/lib/realtime/vote-room/rank";
import type { VoteSubmitResult } from "@/lib/realtime/vote-room/use-vote-room";
import { submitError } from "./vote-answer-form";

export interface RankAnswerFormProps {
  sheet: RankSheet;
  onSubmit: (draft: RankDraft) => Promise<VoteSubmitResult>;
  /** Why answering is off right now (shown, and the button is disabled). */
  disabledReason?: string | null;
  submitLabel?: string;
}

/** "1st", "2nd", "3rd", "4th" … up to 10. */
export function ordinal(n: number): string {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
}

export function RankAnswerForm({
  sheet,
  onSubmit,
  disabledReason = null,
  submitLabel = "Send my order",
}: RankAnswerFormProps) {
  const [order, setOrder] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // A placed option's button goes away: focus moves to the next one still to
  // place (by position), or to Send once all are placed.
  const [focusAt, setFocusAt] = useState<number | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorId = useId();
  const headingId = useId();
  const announce = useAnnounce();

  const signature = `${sheet.id}|${sheet.options.map((x) => x.id).join("|")}`;
  useEffect(() => {
    setOrder([]);
    setFormError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  useEffect(() => {
    if (focusAt === null) return;
    setFocusAt(null);
    const left = formRef.current?.querySelectorAll<HTMLButtonElement>("button[data-unplaced]");
    if (left && left.length > 0) left[Math.min(focusAt, left.length - 1)].focus();
    else formRef.current?.querySelector<HTMLButtonElement>("button[type=submit]")?.focus();
  }, [focusAt]);

  const textOf = (id: string) => sheet.options.find((x) => x.id === id)?.text ?? id;
  const unplaced = sheet.options.filter((x) => !order.includes(x.id));

  const place = (id: string, at: number) => {
    const next = [...order, id];
    setOrder(next);
    setFormError(null);
    setFocusAt(at);
    announce(`${textOf(id)} is ${ordinal(next.length)}.`);
  };

  const move = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= order.length) return;
    const next = order.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
    announce(`${textOf(next[j])} is ${ordinal(j + 1)}.`);
  };

  const remove = (i: number) => {
    const id = order[i];
    setOrder(order.filter((_, k) => k !== i));
    headingRef.current?.focus();
    announce(`${textOf(id)} taken out of your order.`);
  };

  const send = async () => {
    if (sending || disabledReason) return;
    if (order.length !== sheet.options.length) {
      setFormError(`Put every option in order: ${unplaced.length} still to place.`);
      return;
    }
    const draft: RankDraft = Object.fromEntries(order.map((id, place) => [id, place]));
    setSending(true);
    const result = await onSubmit(draft);
    setSending(false);
    if (result === "sent") {
      setOrder([]);
      setFormError(null);
      return;
    }
    setFormError(submitError(result));
  };

  const onFormSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void send();
  };

  return (
    <form
      ref={formRef}
      onSubmit={onFormSubmit}
      noValidate
      aria-describedby={formError ? errorId : undefined}
      className="space-y-4"
    >
      <p className="text-sm text-sub">
        Tap the options in the order you want them, first choice first. Then move one up or down if
        you change your mind.
      </p>

      <section aria-labelledby={headingId} className="space-y-2">
        <h3
          ref={headingRef}
          id={headingId}
          tabIndex={-1}
          className="text-sm font-semibold text-text outline-none"
        >
          Your order ({order.length} of {sheet.options.length})
        </h3>
        {order.length === 0 ? (
          <p className="text-sm text-sub">Nothing placed yet.</p>
        ) : (
          <ol className="space-y-2">
            {order.map((id, i) => (
              <li
                key={id}
                className="flex min-w-0 items-center gap-1 rounded-lg border border-accent bg-card p-2"
              >
                <span className="w-9 shrink-0 font-data text-sm text-sub">{ordinal(i + 1)}</span>
                <span className="min-w-0 flex-1 break-words text-sm text-text">{textOf(id)}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${textOf(id)} up`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${textOf(id)} down`}
                  disabled={i === order.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Take ${textOf(id)} out of your order`}
                  onClick={() => remove(i)}
                >
                  <Undo2 aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ol>
        )}
      </section>

      {unplaced.length > 0 && (
        <ul className="space-y-2" aria-label="Still to place">
          {unplaced.map((option, i) => (
            <li key={option.id}>
              <Button
                type="button"
                variant="outline"
                data-unplaced=""
                className="h-auto w-full justify-start whitespace-normal py-2.5 text-left"
                onClick={() => place(option.id, i)}
              >
                <span className="font-data text-sub">{ordinal(order.length + 1)}:</span>
                <span className="min-w-0 break-words">{option.text}</span>
                <span className="sr-only">. Put it next.</span>
              </Button>
              {option.hint && <p className="mt-1 px-1 text-xs text-sub">{option.hint}</p>}
            </li>
          ))}
        </ul>
      )}

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
