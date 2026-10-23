"use client";

import { useId, type ReactNode } from "react";
import { Field } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { EPIC_COLORS, colorVar, type EpicColorKey } from "@/lib/roadmap/palette";
import { currentQuarter, quarterOptions } from "@/lib/roadmap/quarters";

const SELECT_CLASS =
  "flex h-11 w-full min-w-0 rounded-md border border-input bg-transparent px-3 font-data text-base text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:h-9 md:text-sm";

/**
 * A quarter, picked from a list instead of typed ("2026 Q3"): the free
 * text accepted "next spring" and then drew nothing. The current quarter
 * is marked, and a stored quarter outside the usual years stays listed.
 */
export function QuarterPicker({
  label,
  value,
  onChange,
  now = new Date(),
  also = [],
  hint,
  error,
  required,
  className,
}: {
  label: string;
  /** "2026 Q3", or "" when none is picked yet. */
  value: string;
  onChange: (quarter: string) => void;
  now?: Date;
  /** Other quarters to keep in the list (the epics' dates). */
  also?: readonly string[];
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
}) {
  const options = quarterOptions(now, [value, ...also]);
  const thisQuarter = currentQuarter(now);
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {(props) => (
        <select
          {...props}
          className={SELECT_CLASS}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {value === "" && (
            <option value="" disabled>
              Pick a quarter
            </option>
          )}
          {options.map((q) => (
            <option key={q} value={q}>
              {q === thisQuarter ? `${q} (this quarter)` : q}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/**
 * The epic's colour from the theme palette. Native radios, so arrow keys
 * move between swatches and the group is one tab stop.
 */
export function ColorPicker({
  value,
  onChange,
  error,
}: {
  value: EpicColorKey | "";
  onChange: (key: EpicColorKey) => void;
  error?: ReactNode;
}) {
  const name = useId();
  const errorId = `${name}-error`;
  return (
    <fieldset
      className="flex min-w-0 flex-col gap-1.5"
      aria-describedby={error ? errorId : undefined}
    >
      <legend className="mb-1.5 text-sm text-text">Colour</legend>
      <div className="flex flex-wrap gap-2">
        {EPIC_COLORS.map((c) => (
          <label key={c.key} className="relative inline-flex cursor-pointer">
            <input
              type="radio"
              name={name}
              value={c.key}
              checked={value === c.key}
              onChange={() => onChange(c.key)}
              className="peer sr-only"
            />
            <span
              aria-hidden="true"
              className={cn(
                "min-touch-coarse h-7 w-7 rounded-full border-2 border-transparent ring-offset-2 ring-offset-bg transition",
                "peer-checked:border-text peer-focus-visible:ring-2 peer-focus-visible:ring-accent"
              )}
              style={{ background: colorVar(c.key) }}
            />
            <span className="sr-only">{c.name}</span>
          </label>
        ))}
      </div>
      {error && (
        <p id={errorId} className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
