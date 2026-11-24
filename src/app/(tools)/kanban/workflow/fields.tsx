"use client";

import type { ReactNode } from "react";
import { ONE_LINE_AREA, oneLineText } from "@/components/shared/blur-fields";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

/** Native selects beside Inputs: 44 px on touch, the Input's size for a mouse at md+. */
export const SELECT_CLASS =
  "flex h-11 pointer-fine:md:h-9 w-full rounded-md border border-input bg-card px-3 text-base pointer-fine:md:text-sm text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/**
 * One line of text with its label, hint and error. A policy is a sentence,
 * so it wraps rather than hide its end on a phone; Enter still submits the
 * form, as an input's does, and a pasted line break becomes a space.
 */
export function TextField({
  label,
  hint,
  error,
  value,
  max,
  placeholder,
  onChange,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  value: string;
  max: number;
  placeholder?: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(p) => (
        <Textarea
          {...p}
          rows={1}
          className={ONE_LINE_AREA}
          value={value}
          maxLength={max}
          placeholder={placeholder}
          onChange={(e) => onChange(oneLineText(e.target.value))}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }}
        />
      )}
    </Field>
  );
}

/** A few lines of text with its label, hint and error. */
export function NoteField({
  label,
  hint,
  error,
  value,
  max,
  onChange,
  rows = 3,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  value: string;
  max: number;
  onChange: (value: string) => void;
  rows?: number;
}) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(p) => (
        <Textarea
          {...p}
          value={value}
          maxLength={max}
          rows={rows}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}
