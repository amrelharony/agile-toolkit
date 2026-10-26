"use client";

/**
 * Shared table-cell atoms for the prioritizer.
 *
 * `ScoreBadge` is the tinted pill a method's score sits in on the WSJF and
 * RICE tabs, in theme tokens (the accent tint), never a hard-coded hex.
 */

import { cn } from "@/lib/utils";

export function ScoreBadge({ value, className }: { value: string | number; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex min-w-[52px] items-center justify-center rounded border border-accent/30 bg-accent/10 px-2 py-0.5 font-data text-xs font-bold text-accent",
        className
      )}
    >
      {value}
    </span>
  );
}
