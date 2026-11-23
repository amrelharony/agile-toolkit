"use client";

import type { ReactNode } from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/** Native selects beside Inputs: 44 px on touch, the Input's size for a mouse at md+. */
export const SELECT_CLASS =
  "flex h-11 pointer-fine:md:h-9 w-full rounded-md border border-input bg-card px-3 text-base pointer-fine:md:text-sm text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/** One line of text with its label, hint and error. */
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
        <Input
          {...p}
          value={value}
          maxLength={max}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
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
