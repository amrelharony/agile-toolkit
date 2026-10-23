"use client";

import type { ReactNode } from "react";
import { ToggleGroup, type ToggleOption } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { focusFirstInvalid } from "@/lib/utils/form";

// Forms import it from here next to the picker it knows how to focus.
export { focusFirstInvalid };

/** One value on a method's scale, e.g. RICE impact 3 "Massive". */
export interface ScaleStep {
  value: number;
  /** A word shown after the number ("Massive"). */
  name?: string;
  /** What the value means; the option's tooltip and accessible description. */
  meaning?: string;
}

/** A finite number from a stored field (numbers or numeric strings), else undefined. */
export function toNumber(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function isOnScale(steps: readonly ScaleStep[], v: unknown): boolean {
  const n = toNumber(v);
  return n !== undefined && steps.some((s) => s.value === n);
}

/** A value that's set but not on the scale: stored before the scale existed, or imported. */
export function offScale(steps: readonly ScaleStep[], v: unknown): number | null {
  const n = toNumber(v);
  return n !== undefined && !isOnScale(steps, n) ? n : null;
}

export interface ScalePickerProps {
  /** Visible label and the radio group's name. */
  label: string;
  steps: readonly ScaleStep[];
  /** The chosen value; null when nothing is chosen yet. */
  value: number | null;
  onValueChange: (value: number) => void;
  /**
   * Offer "Clear" while a value is chosen, so a score can go back to "Not
   * scored" instead of being forced to a value (contract item 2).
   */
  onClear?: () => void;
  /**
   * An off-scale value the item already held. It stays on offer as
   * "Custom: …" so picking a scale value by mistake can be taken back.
   */
  custom?: number | null;
  /** How a value reads, e.g. (v) => `${v}%`. */
  format?: (value: number) => string;
  /** Short legend under the options. */
  hint?: ReactNode;
  error?: string;
  size?: "sm" | "md";
  className?: string;
  /**
   * Layout for the options, e.g. "grid grid-cols-5 sm:inline-flex" so a
   * 1–10 scale wraps as two even rows of five on a phone instead of 9 + 1.
   */
  optionsClassName?: string;
}

/**
 * A method's standard scale as a segmented control (radio semantics, arrow
 * keys, one tab stop).
 *
 * A value that isn't on the scale is never changed silently: it shows as a
 * checked "Custom: 1.5" option until the user picks a scale value.
 */
export function ScalePicker({
  label,
  steps,
  value,
  onValueChange,
  onClear,
  custom,
  format = String,
  hint,
  error,
  size = "md",
  className,
  optionsClassName,
}: ScalePickerProps) {
  const options: ToggleOption<number>[] = steps.map((s) => ({
    value: s.value,
    // One inline wrapper: the option is a flex box, which would drop the space.
    label: s.name ? (
      <span>
        <span className="font-mono">{format(s.value)}</span> {s.name}
      </span>
    ) : (
      format(s.value)
    ),
    description: s.meaning,
  }));
  const customValue = offScale(steps, value) ?? offScale(steps, custom);
  if (customValue !== null) {
    options.push({
      value: customValue,
      label: `Custom: ${format(customValue)}`,
      description: "Not on the scale. Pick a scale value to replace it.",
    });
  }

  return (
    <div
      className={cn("flex min-w-0 flex-col gap-1.5", className)}
      data-scale-invalid={error ? "true" : undefined}
    >
      <div className="flex min-h-6 items-center justify-between gap-2">
        {/* The radio group carries the same name; this is the visible label. */}
        <span className="text-sm text-text" aria-hidden="true">
          {label}
        </span>
        {onClear && value !== null && (
          <button
            type="button"
            onClick={onClear}
            aria-label={`Clear ${label}`}
            className="min-touch-coarse rounded text-xs text-sub underline-offset-2 hover:text-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Clear
          </button>
        )}
      </div>
      <ToggleGroup
        label={label}
        size={size}
        className={optionsClassName}
        options={options}
        value={value}
        onValueChange={onValueChange}
      />
      {hint && <p className="text-xs text-sub">{hint}</p>}
      {error && (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** A stored score in a table cell, tagged "custom" when it isn't on the scale. */
export function ScaleValue({ steps, value }: { steps: readonly ScaleStep[]; value: unknown }) {
  const n = toNumber(value);
  if (n === undefined) return <>{typeof value === "string" ? value : ""}</>;
  return (
    <>
      {n}
      {!isOnScale(steps, n) && <span className="ml-1 font-sans text-sub">custom</span>}
    </>
  );
}
