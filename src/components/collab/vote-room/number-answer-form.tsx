"use client";

/**
 * A participant's answer to a number round (Quick Vote's "guess the
 * number", confidence in %, how many days): one number in the host's
 * range. The box starts blank, so nobody's answer is a default; big − and
 * + buttons step it by the round's smallest decimal (from the middle of
 * the range when it is blank), for a thumb on a phone, and the box takes
 * typing (a comma counts as a decimal point).
 *
 * The draft lives in this component only, is never stored, and is cleared
 * once sent. Callers key it by round id.
 */

import { useEffect, useId, useState, type FormEvent } from "react";
import { Minus, Plus, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  NUMBER_DRAFT_KEY,
  numberAmount,
  numberDraftProblem,
  type NumberSheet,
} from "@/lib/realtime/vote-room/number";
import type { VoteSubmitResult } from "@/lib/realtime/vote-room/use-vote-room";
import { submitError } from "./vote-answer-form";

export interface NumberAnswerFormProps {
  sheet: NumberSheet;
  onSubmit: (draft: Record<string, number | null>) => Promise<VoteSubmitResult>;
  /** Why answering is off right now (shown, and the button is disabled). */
  disabledReason?: string | null;
  submitLabel?: string;
}

const NUMBER_RE = /^-?\d+(?:[.,]\d+)?$/;

/** The box's number: blank is null, a readable number is the number, anything else NaN. */
export function readNumberBox(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  return NUMBER_RE.test(t) ? Number(t.replace(",", ".")) : NaN;
}

/** `n` on the round's grid, as the box shows it. */
function show(n: number, decimals: number): string {
  return n.toFixed(decimals);
}

/** "From 0 to 100%.", "From 1 to 30 days, in steps of 0.5." */
export function numberRangeText(sheet: NumberSheet): string {
  const amount = (n: number) => numberAmount(n, sheet.unit, sheet.decimals);
  const steps =
    sheet.decimals === 0
      ? " Whole numbers."
      : ` Up to ${sheet.decimals} decimal ${sheet.decimals === 1 ? "place" : "places"}.`;
  return `From ${amount(sheet.min)} to ${amount(sheet.max)}.${steps}`;
}

export function NumberAnswerForm({
  sheet,
  onSubmit,
  disabledReason = null,
  submitLabel = "Send answer",
}: NumberAnswerFormProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const errorId = useId();
  const step = 1 / 10 ** sheet.decimals;

  const signature = `${sheet.id}|${sheet.min}|${sheet.max}|${sheet.decimals}`;
  useEffect(() => {
    setValue("");
    setError(null);
    setFormError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const current = readNumberBox(value);

  const nudge = (by: -1 | 1) => {
    const scale = 10 ** sheet.decimals;
    const base =
      current === null || Number.isNaN(current)
        ? Math.round(((sheet.min + sheet.max) / 2) * scale) / scale
        : current + by * step;
    const next = Math.min(sheet.max, Math.max(sheet.min, Math.round(base * scale) / scale));
    setValue(show(next, sheet.decimals));
    setError(null);
    setFormError(null);
  };

  const send = async () => {
    if (sending || disabledReason) return;
    const n = readNumberBox(value);
    const draft = { [NUMBER_DRAFT_KEY]: n === null || Number.isNaN(n) ? null : n };
    const problem = Number.isNaN(n) ? "unreadable" : numberDraftProblem(draft, sheet);
    if (problem) {
      const amount = (x: number) => numberAmount(x, sheet.unit, sheet.decimals);
      setError(
        problem === "missing"
          ? "Enter a number."
          : problem === "unreadable"
            ? "Enter a number, like 12 or 3.5."
            : problem === "out-of-range"
              ? `Enter a number from ${amount(sheet.min)} to ${amount(sheet.max)}.`
              : sheet.decimals === 0
                ? "Enter a whole number."
                : `Use at most ${sheet.decimals} decimal ${sheet.decimals === 1 ? "place" : "places"}.`
      );
      return;
    }
    setSending(true);
    const result = await onSubmit(draft);
    setSending(false);
    if (result === "sent") {
      setValue("");
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
      onSubmit={onFormSubmit}
      noValidate
      aria-describedby={formError ? errorId : undefined}
      className="space-y-4"
    >
      <Field
        label={sheet.unit ? `Your answer (${sheet.unit})` : "Your answer"}
        hint={[sheet.hint, numberRangeText(sheet)].filter(Boolean).join(" ")}
        error={error}
        required
      >
        {(props) => (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="px-4"
              aria-label={`Down by ${show(step, sheet.decimals)}`}
              disabled={current !== null && !Number.isNaN(current) && current <= sheet.min}
              onClick={() => nudge(-1)}
            >
              <Minus aria-hidden="true" />
            </Button>
            <Input
              {...props}
              type="text"
              inputMode={sheet.decimals === 0 && sheet.min >= 0 ? "numeric" : "decimal"}
              autoComplete="off"
              className="min-h-12 flex-1 text-center font-data text-lg"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
                setFormError(null);
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="px-4"
              aria-label={`Up by ${show(step, sheet.decimals)}`}
              disabled={current !== null && !Number.isNaN(current) && current >= sheet.max}
              onClick={() => nudge(1)}
            >
              <Plus aria-hidden="true" />
            </Button>
          </div>
        )}
      </Field>
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
