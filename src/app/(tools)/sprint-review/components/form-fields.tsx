"use client";

/**
 * Shared form atoms for the Sprint Review tabs.
 *
 * `SectionLabel` is the small uppercase field caption used across tabs.
 * `NumCell` is a numeric input that doesn't snap mid-edit — it holds a local
 * string draft so intermediate states like "" or "1." don't get rewritten by
 * clamping, committing on blur/Enter and reverting on invalid input.
 */

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-sub font-medium uppercase tracking-wider mb-1">{children}</p>;
}

export function NumCell({
  value,
  onCommit,
  min = 0,
  max,
  className,
  ariaLabel,
}: {
  value: number;
  onCommit: (n: number) => void;
  min?: number;
  max?: number;
  className?: string;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Number(draft);
    if (Number.isFinite(n)) {
      onCommit(Math.max(min, Math.min(max ?? Infinity, n)));
    } else {
      setDraft(String(value));
    }
  };
  return (
    <Input
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
