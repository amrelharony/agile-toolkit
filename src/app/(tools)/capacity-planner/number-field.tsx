"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { validateNumber, withUnit, type NumberRule } from "./model";

/**
 * A number typed into a draft and saved on blur or Enter, only when it is
 * valid. Clearing the field used to save 0 (a member's availability, and
 * with it their hours, silently became nothing); now a blank or
 * out-of-range value shows why under the field, and the saved value, which
 * the totals keep using, is named in the message.
 */
export function NumberField({
  label,
  value,
  onCommit,
  rule,
  step,
  suffix,
  hint,
  hideLabel,
  className,
}: {
  label: ReactNode;
  /** The saved value. */
  value: number;
  onCommit: (next: number) => void;
  rule: NumberRule;
  step?: number;
  /** Shown inside the field, after the number ("days", "%"). */
  suffix?: string;
  hint?: ReactNode;
  hideLabel?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  // Errors show once the user leaves the field (or presses Enter), not while
  // they clear it to type a new value.
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    setDraft(String(value));
    setTouched(false);
  }, [value]);

  const checked = validateNumber(draft, rule);
  const error =
    touched && !checked.ok
      ? `${checked.error} Still counting ${withUnit(value, rule)}.`
      : undefined;

  const commit = () => {
    setTouched(true);
    if (checked.ok && checked.value !== value) onCommit(checked.value);
  };

  return (
    <Field label={label} hint={hint} error={error} hideLabel={hideLabel} className={className}>
      {(control) => (
        <div className="relative">
          <Input
            {...control}
            type="number"
            inputMode="decimal"
            value={draft}
            min={rule.min}
            max={rule.max}
            step={step}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              }
            }}
            className={cn("font-data", suffix && "pr-12")}
          />
          {suffix && (
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-sub">
              {suffix}
            </span>
          )}
        </div>
      )}
    </Field>
  );
}
