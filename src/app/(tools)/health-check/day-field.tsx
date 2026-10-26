"use client";

import { useEffect, useState, type ReactNode, type Ref } from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export interface DayFieldProps {
  label: ReactNode;
  /** The committed day, YYYY-MM-DD. */
  value: string;
  /** The latest day allowed (today): a check or check-in can be backdated, never forward-dated. */
  max: string;
  /** Why a typed day can't be used, or null. */
  problem: (day: string) => string | null;
  /** Called only with a day `problem` accepts. */
  onChange: (day: string) => void;
  /**
   * The field's own problem as it changes (null once the day is good
   * again), so a page that saves on its own button can refuse while the
   * field shows an error instead of saving under the last good day.
   */
  onProblem?: (problem: string | null) => void;
  /**
   * "change" (the default) passes each good day on as it is typed; "blur"
   * only when the field is left or Enter is pressed, for a day edited in a
   * list sorted by it, which would otherwise move under the cursor while a
   * year is half typed.
   */
  commit?: "change" | "blur";
  inputRef?: Ref<HTMLInputElement>;
  hint?: ReactNode;
  className?: string;
  disabled?: boolean;
}

/** "24 Oct 2026" for a YYYY-MM-DD day. */
function longDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(y, (m || 1) - 1, d || 1);
  return Number.isNaN(t.getTime())
    ? day
    : t.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * A backdatable day. A day the input can't use (blank, not a date, in the
 * future) shows its reason inline and is never passed on; while it shows,
 * the hint says which day is still in use, so nothing is saved under a day
 * the screen doesn't show. Shared by the Health Check, Psych Safety and
 * Mood Tracker pages.
 */
export function DayField({
  label,
  value,
  max,
  problem,
  onChange,
  onProblem,
  commit = "change",
  inputRef,
  hint,
  className,
  disabled,
}: DayFieldProps) {
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setText(value);
    setError(null);
    onProblem?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the committed day changes
  }, [value]);

  const report = (why: string | null) => {
    setError(why);
    onProblem?.(why);
  };
  const commitText = () => {
    const why = problem(text);
    report(why);
    if (!why && text !== value) onChange(text);
  };

  return (
    <Field
      label={label}
      hint={error ? `Keeps ${longDay(value)} until a valid day is picked.` : hint}
      error={error ?? undefined}
      className={className}
    >
      {(props) => (
        <Input
          {...props}
          ref={inputRef}
          type="date"
          max={max}
          value={text}
          disabled={disabled}
          onChange={(e) => {
            const next = e.target.value;
            setText(next);
            const why = problem(next);
            if (commit === "blur") {
              // Say what's wrong as it is typed; pass nothing on until the field is left.
              report(why);
              return;
            }
            report(why);
            if (!why) onChange(next);
          }}
          onBlur={commit === "blur" ? commitText : undefined}
          onKeyDown={
            commit === "blur"
              ? (e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitText();
                  }
                }
              : undefined
          }
          className="w-auto max-w-[12rem]"
        />
      )}
    </Field>
  );
}
