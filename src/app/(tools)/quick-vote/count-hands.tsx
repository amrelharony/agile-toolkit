"use client";

/**
 * Count hands for a choice round ("One screen"): people hold up a hand,
 * their hold-up card or a paper slip, and the host types how many chose
 * each option. The same rules as a live round: totals only, shown and saved
 * from the round's minimum (3, or 5 for the formats that ask about people),
 * and totals real answers could give. Nothing is kept until Save round.
 * A format whose answers stay anonymous (ESVP) is counted from paper slips.
 */

import { useId, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ChoiceRoundResult, ChoiceSheet } from "@/lib/realtime/vote-room/choice";
import { focusFirstInvalid } from "@/lib/utils/form";
import { handCountResult, validateHandCounts, type HandCounts } from "./model";

export function CountHands({
  sheet,
  minN,
  slips = false,
  onSave,
  disabled = false,
}: {
  sheet: ChoiceSheet;
  minN: number;
  /** Counted from paper slips, never a show of hands: the answers stay anonymous. */
  slips?: boolean;
  /** Returns false when nothing was stored (the tool said why). */
  onSave: (result: ChoiceRoundResult) => boolean;
  disabled?: boolean;
}) {
  const [typed, setTyped] = useState<HandCounts>({ counts: {}, people: "" });
  const [tried, setTried] = useState(false);
  const [saved, setSaved] = useState(false);
  const formId = useId();
  const check = validateHandCounts(sheet, typed, minN);
  const errors = tried && !check.ok ? check.errors : {};
  const several = sheet.mode !== "single";
  const what = sheet.mode === "dots" ? "Dots on it" : "People who picked it";

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setTried(true);
    if (!check.ok) {
      const form = e.currentTarget;
      // After React marks the fields invalid.
      requestAnimationFrame(() => focusFirstInvalid(form));
      return;
    }
    const result = handCountResult(sheet, check.values, minN);
    if (result && onSave(result)) {
      setSaved(true);
      setTyped({ counts: {}, people: "" });
      setTried(false);
    }
  };

  return (
    <form
      noValidate
      onSubmit={submit}
      aria-labelledby={`${formId}-title`}
      className="space-y-3 rounded-lg border border-border bg-surface-deep p-3"
    >
      <h3 id={`${formId}-title`} className="text-sm font-semibold text-text">
        {slips ? "Count the slips" : "Count hands"}: {sheet.title}
      </h3>
      <p className="text-xs text-sub">
        {sheet.mode === "dots"
          ? `Count the dots on each option (${sheet.limit} each).`
          : sheet.mode === "multi"
            ? `Count the people who picked each option (up to ${sheet.limit} each).`
            : slips
              ? "Count the slips for each option."
              : "Count the people who picked each option."}{" "}
        Totals show from {minN} people.
      </p>
      <ul className="space-y-2">
        {sheet.options.map((o) => (
          <li key={o.id} className="flex items-center justify-between gap-3">
            <label htmlFor={`${formId}-${o.id}`} className="min-w-0 break-words text-sm text-text">
              {o.text}
            </label>
            <Input
              id={`${formId}-${o.id}`}
              inputMode="numeric"
              className="w-24 shrink-0"
              aria-label={`${what}: ${o.text}`}
              aria-invalid={errors.counts ? true : undefined}
              aria-describedby={errors.counts ? `${formId}-counts` : undefined}
              value={typed.counts[o.id] ?? ""}
              disabled={disabled}
              onChange={(e) => {
                setSaved(false);
                setTyped((t) => ({ ...t, counts: { ...t.counts, [o.id]: e.target.value } }));
              }}
            />
          </li>
        ))}
      </ul>
      {several && (
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={`${formId}-people`} className="text-sm text-text">
            People who answered
          </label>
          <Input
            id={`${formId}-people`}
            inputMode="numeric"
            className="w-24 shrink-0"
            aria-invalid={errors.people ? true : undefined}
            aria-describedby={errors.people ? `${formId}-people-error` : undefined}
            value={typed.people}
            disabled={disabled}
            onChange={(e) => {
              setSaved(false);
              setTyped((t) => ({ ...t, people: e.target.value }));
            }}
          />
        </div>
      )}
      {errors.counts && (
        <p id={`${formId}-counts`} role="alert" className="text-xs text-danger">
          {errors.counts}
        </p>
      )}
      {errors.people && (
        <p id={`${formId}-people-error`} role="alert" className="text-xs text-danger">
          {errors.people}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="toolkit" className="gap-1.5" disabled={disabled}>
          <Check aria-hidden="true" />
          Save round
        </Button>
        {saved && (
          <p role="status" className="text-xs text-success">
            Saved to the results below.
          </p>
        )}
      </div>
    </form>
  );
}
