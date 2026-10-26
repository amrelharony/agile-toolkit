"use client";

import { useEffect, useState, type ReactNode } from "react";
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
  hint?: ReactNode;
  className?: string;
  disabled?: boolean;
}

/**
 * A backdatable day. A day the input can't use (blank, not a date, in the
 * future) shows its reason inline and is never passed on, so whatever is
 * saved next uses the last good day, which stays on screen in the hint.
 * Shared by the Health Check, Psych Safety and Mood Tracker pages.
 */
export function DayField({
  label,
  value,
  max,
  problem,
  onChange,
  hint,
  className,
  disabled,
}: DayFieldProps) {
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setText(value);
    setError(null);
  }, [value]);
  return (
    <Field label={label} hint={hint} error={error ?? undefined} className={className}>
      {(props) => (
        <Input
          {...props}
          type="date"
          max={max}
          value={text}
          disabled={disabled}
          onChange={(e) => {
            const next = e.target.value;
            setText(next);
            const why = problem(next);
            setError(why);
            if (!why) onChange(next);
          }}
          className="w-auto max-w-[12rem]"
        />
      )}
    </Field>
  );
}
