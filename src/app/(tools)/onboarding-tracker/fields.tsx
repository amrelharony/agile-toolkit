"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { TARGET_MAX, isTarget } from "./model";

const blurOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
  if (e.key === "Enter") e.currentTarget.blur();
};

/**
 * A name edited in place: saved when focus leaves (or on Enter), and an
 * emptied one goes back to what it was rather than saving a blank.
 */
export function NameField({
  value,
  onCommit,
  label,
  className,
  maxLength = 80,
}: {
  value: string;
  onCommit: (next: string) => void;
  label: string;
  className?: string;
  maxLength?: number;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <Input
      value={draft}
      maxLength={maxLength}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={blurOnEnter}
      onBlur={() => {
        const next = draft.replace(/\s+/g, " ").trim();
        if (!next) setDraft(value);
        else if (next !== value) onCommit(next);
      }}
      className={cn("h-8 border-border bg-bg text-sm", className)}
    />
  );
}

/**
 * A target in whole days (1–365), edited in place: anything else goes back
 * to the saved value, so a cleared field never saves 0.
 */
export function TargetField({
  value,
  onCommit,
  label,
}: {
  value: number;
  onCommit: (next: number) => void;
  label: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <span className="inline-flex items-center gap-1 text-xs text-sub">
      <Input
        type="number"
        inputMode="numeric"
        min={1}
        max={TARGET_MAX}
        value={draft}
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={blurOnEnter}
        onBlur={() => {
          const next = Number(draft);
          if (!draft.trim() || !isTarget(next)) setDraft(String(value));
          else if (next !== value) onCommit(next);
        }}
        className="h-8 w-16 border-border bg-bg px-2 text-xs"
      />
      days
    </span>
  );
}
