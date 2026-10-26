"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface ToggleOption<T extends string | number> {
  value: T;
  label: React.ReactNode;
  /** Accessible name when `label` isn't plain text (e.g. an icon or colour). */
  ariaLabel?: string;
  /** Extra context shown as a tooltip and read by screen readers. */
  description?: string;
  disabled?: boolean;
}

export interface ToggleGroupProps<T extends string | number> {
  /** Names the group, e.g. "Impact" or "Health of Delivering value". */
  label: string;
  options: ToggleOption<T>[];
  value: T | null | undefined;
  onValueChange: (value: T) => void;
  className?: string;
  size?: "sm" | "md";
  /** Ids of the hint and error that describe the group. */
  "aria-describedby"?: string;
}

/**
 * Single-choice segmented control with radio semantics.
 *
 * For scales and pickers that used to be rows of plain buttons whose state
 * was only a colour (traffic lights, RICE impact, chips): screen readers
 * hear "radio, checked, 2 of 5", and arrow keys move between options with
 * one tab stop for the group (WCAG 4.1.2, 1.4.1).
 */
export function ToggleGroup<T extends string | number>({
  label,
  options,
  value,
  onValueChange,
  className,
  size = "md",
  "aria-describedby": describedBy,
}: ToggleGroupProps<T>) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.filter((o) => !o.disabled);
  const selectedIndex = options.findIndex((o) => o.value === value);
  // Roving tab stop: the checked option, else the first enabled one.
  const tabStop = selectedIndex >= 0 ? selectedIndex : options.indexOf(enabled[0]);

  const move = (from: number, delta: number) => {
    const n = options.length;
    for (let step = 1; step <= n; step++) {
      const i = (from + delta * step + n * n) % n;
      if (!options[i].disabled) {
        refs.current[i]?.focus();
        onValueChange(options[i].value);
        return;
      }
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-describedby={describedBy}
      className={cn("inline-flex flex-wrap gap-1", className)}
    >
      {options.map((option, i) => {
        const checked = option.value === value;
        return (
          <button
            key={String(option.value)}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={option.ariaLabel}
            title={option.description}
            disabled={option.disabled}
            tabIndex={i === tabStop ? 0 : -1}
            onClick={() => onValueChange(option.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                move(i, 1);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                move(i, -1);
              }
            }}
            className={cn(
              "inline-flex items-center justify-center rounded-md border font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              "disabled:cursor-not-allowed disabled:opacity-50",
              size === "sm" ? "min-h-8 px-2.5 text-xs" : "min-h-9 px-3 text-sm",
              checked
                ? "border-accent bg-accent/15 text-accent"
                : "border-border bg-card text-sub hover:border-accent/40 hover:text-text"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
