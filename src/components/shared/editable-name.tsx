"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface EditableNameProps {
  /** Current committed value. */
  value: string;
  /** Called with the trimmed new value when the user commits an edit. */
  onChange: (next: string) => void;
  /** Placeholder shown inside the input when editing. */
  placeholder?: string;
  /** Pass-through className applied to BOTH the read-only button and the input. */
  className?: string;
  /**
   * Pass-through className applied ONLY to the input. Useful when the
   * editing form needs different styles than the read-only display
   * (story-mapper for example shrinks the input padding).
   */
  inputClassName?: string;
  /**
   * Accessible name for the edit input (e.g. "Role name"). Defaults to
   * "Rename <value>", or the placeholder when the value is empty.
   */
  ariaLabel?: string;
}

/**
 * Click-to-edit text label.
 *
 * Read-only state: an unstyled `<button>` showing the value, hover-tinted
 * to the accent colour to telegraph "this is editable".
 * Edit state: an `<Input>` that auto-focuses + selects all, commits on
 * blur or Enter, reverts on Escape.
 *
 * Replaces three near-identical `function EditableName(...)` definitions
 * across raci / skills-matrix / story-mapper. The unified API is the
 * superset of theirs:
 *   - placeholder (skills-matrix)
 *   - inputClassName (story-mapper)
 *   - className applied to both states (all three)
 *
 * Empty input on blur reverts to the previous value rather than wiping
 * the field — matches the original behaviour and keeps users from
 * accidentally erasing a label.
 */
export function EditableName({
  value,
  onChange,
  placeholder,
  className,
  inputClassName,
  ariaLabel,
}: EditableNameProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Enter / Escape unmount the focused input; hand focus back to the
  // button so keyboard users don't land on <body>. A blur (clicking
  // elsewhere) must not pull focus back, so only those keys set this.
  const refocusButton = useRef(false);

  // Keep the draft in sync when the parent updates `value` from elsewhere
  // (e.g. an external import / undo).
  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (refocusButton.current) {
      refocusButton.current = false;
      buttonRef.current?.focus();
    }
  }, [editing]);

  const commit = useCallback(() => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) {
      onChange(trimmed);
    } else {
      // Revert to the previous value rather than committing an empty
      // string — keeps accidental blurs from wiping the label.
      setDraft(value);
    }
  }, [draft, value, onChange]);

  if (editing) {
    return (
      <Input
        ref={inputRef}
        value={draft}
        placeholder={placeholder}
        aria-label={ariaLabel ?? (value ? `Rename ${value}` : (placeholder ?? "Name"))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          // Prevent Enter from bubbling to a parent <form> (story-mapper
          // and raci both render this inside form-grid wrappers) — without
          // preventDefault a stray submit could fire and reload the page.
          if (e.key === "Enter") {
            e.preventDefault();
            refocusButton.current = true;
            commit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            refocusButton.current = true;
            setDraft(value);
            setEditing(false);
          }
        }}
        className={cn(
          // 36 × 9 (32 → 28 px) is the desktop density target; bump to
          // 44 px on coarse pointers so the click-to-edit doesn't shrink
          // below tap-floor when the user finally lands on the input.
          "h-9 [@media(pointer:coarse)]:h-11 text-sm bg-card border-border text-text focus:border-accent/50 focus:ring-accent/20",
          className,
          inputClassName
        )}
      />
    );
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={() => setEditing(true)}
      className={cn(
        "text-sm text-left truncate hover:text-accent transition-colors cursor-text",
        className
      )}
      title="Click to edit"
    >
      {value || <span className="text-sub italic">{placeholder ?? "—"}</span>}
    </button>
  );
}
