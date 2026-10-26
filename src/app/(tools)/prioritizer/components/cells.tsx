"use client";

/**
 * Shared table-cell atoms for the prioritizer.
 *
 * `ScoreBadge` is the colored pill used in the WSJF/RICE result tables.
 * `NumCell` is a numeric input that defers commit until blur/Enter so editing
 * doesn't snap to clamp bounds mid-keystroke, and commits only an edit.
 */

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";

export function ScoreBadge({
  value,
  color = "#00f0ff",
}: {
  value: string | number;
  color?: string;
}) {
  return (
    <span
      className="inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-data font-bold min-w-[52px]"
      style={{ color, background: `${color}18`, border: `1px solid ${color}30` }}
    >
      {value}
    </span>
  );
}

export function NumCell({
  value,
  min,
  max,
  step,
  onCommit,
  className,
  "aria-label": ariaLabel,
}: {
  /** Absent: the input isn't set, shown blank. */
  value: number | undefined;
  min: number;
  max?: number;
  step?: number;
  onCommit: (n: number) => void;
  className?: string;
  /** Table cells have no visible label: name the field and the row. */
  "aria-label"?: string;
}) {
  const shown = value === undefined ? "" : String(value);
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);

  const commit = () => {
    // Tabbing through a cell commits nothing: a blur without an edit must
    // not write the value back (or stamp an unset input with a number).
    if (draft === shown) return;
    const n = Number(draft);
    if (Number.isFinite(n)) {
      const next = Math.max(min, Math.min(max ?? Infinity, n));
      onCommit(next);
      // Show what was kept (a clamped value) even when it equals the stored
      // one, so no new value arrives to reset the draft.
      setDraft(String(next));
    } else {
      setDraft(shown);
    }
  };

  return (
    <Input
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className={className}
      aria-label={ariaLabel}
    />
  );
}
