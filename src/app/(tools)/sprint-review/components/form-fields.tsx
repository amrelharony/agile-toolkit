"use client";

/**
 * Shared form atoms for the Sprint Review tabs.
 *
 * `SectionLabel` is the small uppercase field caption used across tabs; pass
 * `htmlFor` to render it as the <label> of the field below it.
 * `NumCell` is a numeric input that doesn't snap mid-edit — it holds a local
 * string draft so intermediate states like "" or "1." don't get rewritten by
 * clamping, committing on blur/Enter and reverting on invalid input.
 */

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";

export function SectionLabel({
  children,
  htmlFor,
}: {
  children: React.ReactNode;
  htmlFor?: string;
}) {
  const className = "text-xs text-sub font-medium uppercase tracking-wider mb-1";
  if (htmlFor) {
    return (
      <label htmlFor={htmlFor} className={`block ${className}`}>
        {children}
      </label>
    );
  }
  return <p className={className}>{children}</p>;
}

export function NumCell({
  value,
  onCommit,
  min = 0,
  max,
  className,
  id,
  ariaLabel,
}: {
  value: number;
  onCommit: (n: number) => void;
  min?: number;
  max?: number;
  className?: string;
  id?: string;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    // Number("") is 0, so a blank field is treated as invalid (revert), not 0.
    const n = draft.trim() === "" ? NaN : Number(draft);
    if (Number.isFinite(n)) {
      const clamped = Math.max(min, Math.min(max ?? Infinity, n));
      // Show the clamped value even when it equals `value` (no upstream
      // change → the sync effect above would not fire).
      setDraft(String(clamped));
      onCommit(clamped);
    } else {
      setDraft(String(value));
    }
  };
  return (
    <Input
      id={id}
      type="number"
      min={min}
      max={max}
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
