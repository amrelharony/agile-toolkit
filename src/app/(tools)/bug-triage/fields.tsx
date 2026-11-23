"use client";

import type { ReactNode } from "react";
import { Field } from "@/components/ui/field";

/** A native select sized like <Input>: 44 px on touch, denser only for a mouse at md+. */
export const SELECT_CLASS =
  "flex h-11 pointer-fine:md:h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-base pointer-fine:md:text-sm text-text shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export interface SelectOption {
  value: string;
  label: string;
}

/** A labelled native select. */
export function SelectField({
  label,
  value,
  options,
  onChange,
  hint,
  error,
  className,
}: {
  label: ReactNode;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
}) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(props) => (
        <select
          {...props}
          className={SELECT_CLASS}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}
