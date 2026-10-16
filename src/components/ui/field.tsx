"use client";

import * as React from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Props to spread onto the control inside a <Field>. */
export interface FieldControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  "aria-required"?: true;
}

export interface FieldProps {
  /** Visible label. Use a full noun phrase ("Story points", not "Pts"). */
  label: React.ReactNode;
  /** Helper text under the control (scales, formats, examples). */
  hint?: React.ReactNode;
  /** Validation message; also marks the control invalid. */
  error?: React.ReactNode;
  required?: boolean;
  /** Visually hide the label but keep it for assistive tech. */
  hideLabel?: boolean;
  className?: string;
  children: (control: FieldControlProps) => React.ReactNode;
}

/**
 * Label + control + hint + error, wired together.
 *
 * Most tool forms used a placeholder as the only label (213 fields) or a
 * <Label> without `htmlFor`, so screen readers announced "edit text" with
 * no name, and validation silently disabled the submit button. Field
 * generates the ids and passes `id`, `aria-describedby`, `aria-invalid`
 * and `aria-required` to the control via a render prop:
 *
 *   <Field label="Story points" hint="Fibonacci: 1, 2, 3, 5, 8, 13">
 *     {(props) => <Input {...props} value={pts} onChange={…} />}
 *   </Field>
 */
export function Field({
  label,
  hint,
  error,
  required,
  hideLabel,
  className,
  children,
}: FieldProps) {
  const id = React.useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id} className={cn("text-sm text-text", hideLabel && "sr-only")}>
        {label}
        {required && (
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        )}
      </Label>
      {children({
        id,
        "aria-describedby": describedBy,
        ...(error ? { "aria-invalid": true as const } : {}),
        ...(required ? { "aria-required": true as const } : {}),
      })}
      {hint && (
        <p id={hintId} className="text-xs text-sub">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
