"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { EPIC_COLORS, colorVar, type EpicColorKey } from "@/lib/roadmap/palette";

/**
 * The quarter picker ("2026 Q3") moved to components/shared, where the
 * DORA Scorecard uses it too in the dash format; the roadmap keeps its import.
 */
export { QuarterPicker } from "@/components/shared/quarter-picker";

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
