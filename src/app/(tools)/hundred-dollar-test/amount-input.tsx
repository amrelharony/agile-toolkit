"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * A dollar amount typed freely and saved when the box is left (or on
 * Enter), never per keystroke: each save was an upsert, a history entry, a
 * "scored" signal and a cloud write, so typing "35" saved twice and
 * clearing the box wrote $0 at once.
 *
 *  - A cleared or unreadable box goes back to the saved amount: clearing is
 *    not a way to write $0 (type 0 for that).
 *  - Escape puts the saved amount back without saving.
 *  - `onCommit` returns what was actually saved (the page caps it), and the
 *    box shows that, even when it equals what was there before.
 *
 * BlurInput can't carry aria-describedby (the cap note) or a number
 * keyboard, hence this local twin.
 */
export function AmountInput({
  value,
  label,
  describedBy,
  disabled,
  onCommit,
  className,
}: {
  /** The saved amount; null when none was given. */
  value: number | null;
  /** The accessible name: "Dollars for Search". */
  label: string;
  describedBy?: string;
  disabled?: boolean;
  /** Save `typed`; returns the amount saved, for the box to show. */
  onCommit: (typed: number) => number | null;
  className?: string;
}) {
  const shown = value === null ? "" : String(value);
  const [draft, setDraft] = useState(shown);
  // Another tab, an agent or Undo changed it: show that.
  useEffect(() => setDraft(shown), [shown]);

  const commit = () => {
    const t = draft.trim();
    const n = t === "" ? NaN : Number(t);
    if (!Number.isFinite(n) || (value !== null && n === value)) {
      setDraft(shown);
      return;
    }
    const saved = onCommit(n);
    setDraft(saved === null ? shown : String(saved));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDraft(shown);
    }
  };

  return (
    <Input
      type="number"
      inputMode="numeric"
      min={0}
      max={100}
      step={1}
      value={draft}
      placeholder="—"
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      aria-label={label}
      aria-describedby={describedBy}
      className={cn("h-9 w-20 text-sm", className)}
    />
  );
}
