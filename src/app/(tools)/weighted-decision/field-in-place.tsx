"use client";

import { useEffect, useState, type HTMLAttributes } from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/**
 * A one-line field of the matrix edited in place: saved when it is left
 * or on Enter (never per keystroke), and checked first. A value `check`
 * refuses isn't left on screen as if it were saved: the field goes back to
 * the stored text and says why under it (the shared BlurInput keeps an
 * ignored draft, so a blanked name looked emptied while the old one stayed
 * stored). Escape puts the stored text back as well. The control takes
 * every prop Field hands out, so the hint and the error are tied to it for
 * screen readers.
 */
export function FieldInPlace({
  label,
  hideLabel,
  hint,
  value,
  check,
  onSave,
  className,
  inputClassName,
  maxLength,
  placeholder,
  inputMode,
}: {
  label: string;
  hideLabel?: boolean;
  hint?: string;
  /** The stored text. */
  value: string;
  /** Why `next` (trimmed) can't be saved, or null. */
  check?: (next: string) => string | null;
  /** Save `next` (trimmed); only called when it differs from the stored text. */
  onSave: (next: string) => void;
  /** The Field's wrapper (its place in the row). */
  className?: string;
  inputClassName?: string;
  maxLength?: number;
  placeholder?: string;
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  // A change from elsewhere (an agent, another tab, an Undo) replaces the draft.
  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    const next = draft.trim();
    if (next === value.trim()) {
      setDraft(value);
      setError(null);
      return;
    }
    const why = check?.(next) ?? null;
    setError(why);
    if (why) {
      setDraft(value);
      return;
    }
    onSave(next);
  };

  return (
    <Field
      label={label}
      hideLabel={hideLabel}
      hint={hint}
      error={error ?? undefined}
      className={className}
    >
      {(props) => (
        <Input
          {...props}
          value={draft}
          maxLength={maxLength}
          placeholder={placeholder}
          inputMode={inputMode}
          className={inputClassName}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
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
