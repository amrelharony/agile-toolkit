"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";

/** Largest WIP limit: beyond it the badge overflows the column header. */
export const WIP_LIMIT_MAX = 999;

/** A typed limit as stored: whole, 0–999; anything that isn't a number is 0 (no limit). */
export function clampWipLimit(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(WIP_LIMIT_MAX, Math.floor(n))) : 0;
}

/**
 * Per-column WIP-limit input with a local string draft so each keystroke
 * doesn't write the whole board.
 *
 * BUG-RD3-kanban-2: `setWip(col, n)` previously fired per keystroke, so
 * each character typed in any column's WIP input wrote the full board
 * (cards + limits). On a 200-card board the input loop stalled; clearing
 * the field briefly parked the limit at 0 (the clamp coerced NaN → 0),
 * flashing every column under-WIP in between digits. Drafts here, commit on
 * blur / Enter; an emptied field goes back to the stored limit.
 */
export function WipLimitInput({
  colLabel,
  value,
  onCommit,
}: {
  colLabel: string;
  value: number;
  onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    if (draft === "") {
      setDraft(String(value));
      return;
    }
    const n = Number(draft);
    if (Number.isFinite(n) && n >= 0 && n !== value) {
      onCommit(n);
    } else if (!Number.isFinite(n) || n < 0) {
      setDraft(String(value));
    }
  };
  return (
    <Input
      type="number"
      min={0}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      placeholder="WIP"
      className="h-8 sm:h-7 text-xs bg-bg border-border font-data"
      aria-label={`WIP limit for ${colLabel}`}
    />
  );
}
