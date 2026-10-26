"use client";

import { useEffect, useState } from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface DayInputProps {
  /** The field's accessible name (the label is visually hidden). */
  label: string;
  /** The stored day, "YYYY-MM-DD", or "" for none. */
  value: string;
  /** Called with a day `validate` accepted, once the edit ends. */
  onCommit: (day: string) => void;
  /** Why a day can't be saved, or null. An emptied field arrives as "". */
  validate: (day: string) => string | null;
  /** The date picker's bounds; `validate` still checks a typed day. */
  min?: string;
  max?: string;
  className?: string;
  inputClassName?: string;
}

/**
 * A stored day edited in place, saved when the field is left or on Enter,
 * never on each change: typing a year passes through 0002, 0020 and 0202,
 * which each saved an edit (re-sorting the list, or briefly changing the
 * team's level) or cleared the field mid-typing. A day `validate` refuses
 * isn't saved: the stored one stays, and the reason shows under the field
 * (an alert, so it is announced) until the day is fixed. Escape puts the
 * stored day back.
 *
 * Used by the Maturity, ADKAR and Skills Matrix pages.
 */
export function DayInput({
  label,
  value,
  onCommit,
  validate,
  min,
  max,
  className,
  inputClassName,
}: DayInputProps) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);

  // A change from elsewhere (another device, an Undo) replaces the draft.
  useEffect(() => {
    setDraft(value);
    setError(null);
  }, [value]);

  const commit = () => {
    if (draft === value) {
      setError(null);
      return;
    }
    const why = validate(draft);
    setError(why);
    if (!why) onCommit(draft);
  };

  return (
    <Field label={label} hideLabel error={error ?? undefined} className={cn("gap-1", className)}>
      {(props) => (
        <Input
          {...props}
          type="date"
          min={min}
          max={max}
          className={inputClassName}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            // Once refused, the message follows the typing, so a fixed day clears it.
            if (error) setError(e.target.value === value ? null : validate(e.target.value));
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDraft(value);
              setError(null);
            }
          }}
        />
      )}
    </Field>
  );
}
