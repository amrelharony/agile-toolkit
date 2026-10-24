"use client";

/**
 * `NumCell` is a numeric input that doesn't snap mid-edit — it holds a local
 * string draft so intermediate states like "" or "1." don't get rewritten by
 * clamping, committing on blur/Enter and reverting on invalid input. The
 * Velocity Summary's typed numbers use it.
 *
 * With `zeroAsBlank`, 0 shows as an empty field (its placeholder says what
 * that means) and an emptied field commits 0: in the review's typed numbers
 * 0 is a field nobody filled in, never "0 points done".
 */

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";

const shown = (v: number, zeroAsBlank: boolean) => (zeroAsBlank && v === 0 ? "" : String(v));

export function NumCell({
  value,
  onCommit,
  min = 0,
  max,
  className,
  id,
  ariaLabel,
  zeroAsBlank = false,
  placeholder,
}: {
  value: number;
  onCommit: (n: number) => void;
  min?: number;
  max?: number;
  className?: string;
  id?: string;
  ariaLabel?: string;
  zeroAsBlank?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(() => shown(value, zeroAsBlank));
  useEffect(() => setDraft(shown(value, zeroAsBlank)), [value, zeroAsBlank]);
  const commit = () => {
    const n = Number(draft);
    if (Number.isFinite(n)) {
      const next = Math.max(min, Math.min(max ?? Infinity, n));
      onCommit(next);
      // Show what was kept (a clamped value, or a typed 0 as the blank it
      // means) even when it equals the stored one and no new value arrives.
      setDraft(shown(next, zeroAsBlank));
    } else {
      setDraft(shown(value, zeroAsBlank));
    }
  };
  return (
    <Input
      id={id}
      type="number"
      min={min}
      max={max}
      value={draft}
      placeholder={placeholder}
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
