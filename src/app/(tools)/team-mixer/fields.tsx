"use client";

import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** A whole number typed in, checked: the number, or why it can't be used. */
export function validateWhole(
  text: string,
  min: number,
  max: number
): { ok: true; value: number } | { ok: false; error: string } {
  const t = text.trim();
  if (!t) return { ok: false, error: `Enter a number from ${min} to ${max}.` };
  const n = Number(t);
  if (!Number.isInteger(n) || n < min || n > max) {
    return { ok: false, error: `Enter a whole number from ${min} to ${max}.` };
  }
  return { ok: true, value: n };
}

/**
 * A whole-number setting: what's typed stays as typed, and only a valid
 * number reaches `onChange` (a blank or out-of-range one shows why instead
 * of saving a default). `onValidity` hears the error while one shows, and
 * null once the number is good again or the field goes, so the card can
 * hold its Mix button rather than mix with the last good number unseen.
 */
export function WholeNumberField({
  label,
  value,
  min,
  max,
  hint,
  onChange,
  onValidity,
  className,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  hint?: ReactNode;
  onChange: (n: number) => void;
  onValidity?: (error: string | null) => void;
  className?: string;
}) {
  const [text, setText] = useState(String(value));
  // A change from elsewhere (the example, Amr) shows up here.
  useEffect(() => setText(String(value)), [value]);
  const checked = validateWhole(text, min, max);
  const error = checked.ok ? null : checked.error;
  // The latest callback, so a new one each render doesn't re-report.
  const report = useRef(onValidity);
  useEffect(() => {
    report.current = onValidity;
  });
  useEffect(() => {
    report.current?.(error);
  }, [error]);
  useEffect(() => () => report.current?.(null), []);
  return (
    <Field
      label={label}
      hint={hint}
      error={checked.ok ? undefined : checked.error}
      className={className}
    >
      {(props) => (
        <Input
          {...props}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const next = validateWhole(e.target.value, min, max);
            if (next.ok && next.value !== value) onChange(next.value);
          }}
        />
      )}
    </Field>
  );
}

/** A native select styled like the inputs: easy on a phone, plain for screen readers. */
export function NativeSelect({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      {...props}
      className={cn(
        "flex h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 py-1 text-base text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 pointer-fine:md:h-9 pointer-fine:md:text-sm",
        className
      )}
    />
  );
}
