"use client";

/**
 * Shared table-cell atoms for the prioritizer.
 *
 * `ScoreBadge` is the colored pill used in the WSJF/RICE result tables.
 * `NumCell` is a numeric input that defers commit until blur/Enter so editing
 * doesn't snap to clamp bounds mid-keystroke.
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
  value: number;
  min: number;
  max?: number;
  step?: number;
  onCommit: (n: number) => void;
  className?: string;
  /** Table cells have no visible label: name the field and the row. */
  "aria-label"?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    // A number input reports "" when cleared (or holding junk), and
    // Number("") is 0, which would commit the minimum: treat it as invalid.
    const n = draft.trim() === "" ? NaN : Number(draft);
    if (Number.isFinite(n)) {
      const clamped = Math.max(min, Math.min(max ?? Infinity, n));
      onCommit(clamped);
      // When the clamp lands on the stored value, `value` doesn't change and
      // the effect above won't re-sync, so show the clamped number here.
      setDraft(String(clamped));
    } else {
      setDraft(String(value));
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
