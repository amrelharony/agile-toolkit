"use client";

/**
 * A participant's split in an allocation round (Buy-a-Feature, the $100
 * Test): one whole amount per item. Every box starts blank, so nobody's
 * split is a default, and a blank box counts as 0.
 *
 * The draft lives in this component only. It is never stored, and it is
 * cleared once the split is sent. "Left to give" follows the typing (and is
 * announced once the typing pauses). Mistakes show inline: an amount that
 * isn't a whole number, over an item's cap or over the budget sits on its
 * box (focus goes to the first); a split that gives nothing, more than the
 * budget, or less than all of it when the sheet says to give it all out is
 * said under the boxes. Enter sends. Callers key it by round id, so every
 * round starts blank.
 */

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { focusFirstInvalid } from "@/lib/utils/form";
import {
  allocationAmount,
  allocationDraftProblem,
  allocationItemMax,
  type AllocationDraft,
  type AllocationSheet,
} from "@/lib/realtime/vote-room/allocation";
import type { VoteSubmitResult } from "@/lib/realtime/vote-room/use-vote-room";
import { submitError } from "./vote-answer-form";

export interface AllocationAnswerFormProps {
  sheet: AllocationSheet;
  onSubmit: (draft: AllocationDraft) => Promise<VoteSubmitResult>;
  /** Why answering is off right now (shown, and the button is disabled). */
  disabledReason?: string | null;
  /** The send button's label. */
  submitLabel?: string;
}

/** Quiet time before a changed "Left to give" is announced. */
export const LEFT_TO_GIVE_ANNOUNCE_MS = 1_000;

const WHOLE_RE = /^\d+$/;
const NOT_WHOLE = "Enter a whole number, 0 or more.";

function blankValues(sheet: AllocationSheet): Record<string, string> {
  return Object.fromEntries(sheet.items.map((x) => [x.id, ""]));
}

/** A box's amount: blank is 0, digits are the number, anything else is null (not readable). */
function boxAmount(raw: string | undefined): number | null {
  const t = (raw ?? "").trim();
  if (t === "") return 0;
  return WHOLE_RE.test(t) ? Number(t) : null;
}

/** "Left to give: $40.", "All $100 given.", "$20 over your $100." */
export function leftToGiveText(given: number, sheet: AllocationSheet): string {
  const money = (n: number) => allocationAmount(n, sheet.unit);
  const left = sheet.budget - given;
  if (left === 0) return `All ${money(sheet.budget)} given.`;
  if (left < 0) return `${money(-left)} over your ${money(sheet.budget)}.`;
  return `Left to give: ${money(left)}.`;
}

export function AllocationAnswerForm({
  sheet,
  onSubmit,
  disabledReason = null,
  submitLabel = "Send my split",
}: AllocationAnswerFormProps) {
  const [values, setValues] = useState<Record<string, string>>(() => blankValues(sheet));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [focusPending, setFocusPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const errorId = useId();
  const leftId = useId();
  const announce = useAnnounce();
  const money = (n: number) => allocationAmount(n, sheet.unit);

  // A new sheet (a new round) starts blank.
  const signature = `${sheet.id}|${sheet.budget}|${sheet.items.map((x) => `${x.id}:${x.cap ?? ""}`).join("|")}`;
  useEffect(() => {
    setValues(blankValues(sheet));
    setErrors({});
    setFormError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  useEffect(() => {
    if (!focusPending) return;
    setFocusPending(false);
    focusFirstInvalid(formRef.current);
  }, [focusPending]);

  // What's given so far; boxes that can't be read yet count as 0 here.
  const given = sheet.items.reduce((sum, x) => sum + (boxAmount(values[x.id]) ?? 0), 0);
  const leftText = leftToGiveText(given, sheet);

  // Say the new total once typing pauses, not on every keystroke.
  const lastSpoken = useRef<string | null>(null);
  useEffect(() => {
    if (lastSpoken.current === null) {
      lastSpoken.current = leftText;
      return;
    }
    if (lastSpoken.current === leftText) return;
    const t = window.setTimeout(() => {
      lastSpoken.current = leftText;
      announce(leftText);
    }, LEFT_TO_GIVE_ANNOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [leftText, announce]);

  const setValue = (id: string, value: string) => {
    setValues((v) => ({ ...v, [id]: value }));
    setErrors((e) => {
      if (!e[id]) return e;
      const next = { ...e };
      delete next[id];
      return next;
    });
    setFormError(null);
  };

  const send = async () => {
    if (sending || disabledReason) return;
    // A number box reports text it can't read ("5a", "1e") as "": ask the
    // box itself, so that isn't sent as 0.
    const unreadable = new Set<string>();
    formRef.current
      ?.querySelectorAll<HTMLInputElement>("input[data-allocation-item]")
      .forEach((el) => {
        if (el.validity?.badInput === true && el.dataset.allocationItem) {
          unreadable.add(el.dataset.allocationItem);
        }
      });
    const draft: AllocationDraft = {};
    const nextErrors: Record<string, string> = {};
    for (const item of sheet.items) {
      const amount = unreadable.has(item.id) ? null : boxAmount(values[item.id]);
      if (amount === null) {
        nextErrors[item.id] = NOT_WHOLE;
        continue;
      }
      if (item.cap !== undefined && amount > item.cap) {
        nextErrors[item.id] = `At most ${money(item.cap)} on this one.`;
      } else if (amount > sheet.budget) {
        nextErrors[item.id] = `That's more than your ${money(sheet.budget)}.`;
      }
      draft[item.id] = amount;
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setFormError(null);
      setFocusPending(true);
      return;
    }
    const problem = allocationDraftProblem(draft, sheet);
    if (problem) {
      const sum = sheet.items.reduce((s, x) => s + (draft[x.id] ?? 0), 0);
      setFormError(
        problem.problem === "empty"
          ? "Give something to at least one item."
          : problem.problem === "under-budget"
            ? `Give out all ${money(sheet.budget)}: ${money(sheet.budget - sum)} left.`
            : `You've given ${money(sum)}: that's ${money(sum - sheet.budget)} more than your ${money(sheet.budget)}.`
      );
      return;
    }
    setSending(true);
    const result = await onSubmit(draft);
    setSending(false);
    if (result === "sent") {
      // Nothing of the split stays in this browser.
      setValues(blankValues(sheet));
      setFormError(null);
      return;
    }
    setFormError(
      result === "incomplete" ? "This split can't be sent. Check the amounts." : submitError(result)
    );
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
        {sheet.spendAll
          ? `Split ${money(sheet.budget)} across these. Give out all of it.`
          : `You have ${money(sheet.budget)} to give. You don't have to give it all.`}{" "}
        A blank box is {money(0)}.
      </p>
      <ol className="grid gap-3 sm:grid-cols-2">
        {sheet.items.map((item, i) => {
          const max = allocationItemMax(item, sheet.budget);
          const hint =
            [item.hint, item.cap !== undefined ? `At most ${money(max)}.` : null]
              .filter(Boolean)
              .join(" ") || undefined;
          return (
            <li key={item.id} className="rounded-lg border border-border bg-card p-3">
              <Field label={`${i + 1}. ${item.text}`} hint={hint} error={errors[item.id]}>
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={max}
                    step={1}
                    data-allocation-item={item.id}
                    value={values[item.id] ?? ""}
                    onChange={(e) => setValue(item.id, e.target.value)}
                  />
                )}
              </Field>
            </li>
          );
        })}
      </ol>
      <p id={leftId} className="text-sm font-medium text-text">
        {leftText}
      </p>
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
        aria-describedby={leftId}
      >
        <Send className="h-4 w-4" aria-hidden="true" />
        {sending ? "Sending…" : submitLabel}
      </Button>
    </form>
  );
}
