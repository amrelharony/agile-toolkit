"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useInlineEdit } from "@/components/shared/inline-item-editor";
import { PersonPicker } from "@/components/team/person-picker";
import { cn } from "@/lib/utils";
import { NAME_MAX } from "./view";

/** Keep focus in the editor when one of its buttons is pressed, so its blur-save doesn't run first. */
const keepFocus = (e: MouseEvent) => e.preventDefault();

/**
 * One person on a record (the decider, DACI's Driver, RAPID's Recommend),
 * edited in place: the name is a button that opens the roster's
 * PersonPicker, so its notes show only while someone changes it. Enter,
 * Save or clicking away saves, and an emptied name clears it; Escape and
 * Cancel keep the old one. A name over NAME_MAX isn't saved. The same
 * shape as Retro Actions' owner.
 */
export function PersonInPlace({
  label,
  name,
  emptyText = "Nobody yet",
  offerAddToRoster,
  onSave,
}: {
  /** The role, as the record's form names it: "Approver", "Driver". */
  label: string;
  name: string;
  emptyText?: string;
  /** Never for the example: its people aren't the team's. */
  offerAddToRoster: boolean;
  onSave: (name: string) => void;
}) {
  const edit = useInlineEdit();
  const [draft, setDraft] = useState(name);
  const formRef = useRef<HTMLFormElement>(null);
  // Enter or a button, then the blur as the form goes: only the first one counts.
  const finished = useRef(false);
  const current = name.trim();
  const tooLong = draft.trim().length > NAME_MAX;
  const focusInput = () => formRef.current?.querySelector<HTMLInputElement>("input")?.focus();

  useEffect(() => {
    if (edit.editing) formRef.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, [edit.editing]);

  const close = (refocus: boolean) => {
    finished.current = true;
    edit.stop({ refocus });
  };
  const save = (refocus: boolean) => {
    if (finished.current || tooLong) return;
    const next = draft.trim();
    if (next !== current) onSave(next);
    close(refocus);
  };

  if (edit.editing) {
    return (
      // Escape is a convenience on top of the visible Cancel button.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
      <form
        ref={formRef}
        noValidate
        className="flex w-full min-w-0 flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          save(true);
        }}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.preventDefault();
          e.stopPropagation();
          close(true);
        }}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) save(false);
        }}
      >
        {/* "Add to the team" fills in the name and hands focus back to the input. */}
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
        <div
          onMouseDown={(e) => {
            if ((e.target as HTMLElement).closest("button")) e.preventDefault();
          }}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("button")) focusInput();
          }}
        >
          <PersonPicker
            label={label}
            value={draft}
            onChange={setDraft}
            hint="Leave empty to clear."
            error={tooLong ? `Keep the name to ${NAME_MAX} characters.` : undefined}
            offerAddToRoster={offerAddToRoster}
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button type="submit" size="sm" className="h-8" onMouseDown={keepFocus}>
            Save
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8"
            onMouseDown={keepFocus}
            onClick={() => close(true)}
          >
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs text-sub">{label}</span>
      <button
        ref={edit.triggerRef}
        type="button"
        onClick={() => {
          setDraft(name);
          finished.current = false;
          edit.start();
        }}
        title={`Change the ${label}`}
        aria-label={`${label}: ${current || emptyText}. Change`}
        className={cn(
          "min-touch-coarse inline-flex h-8 min-w-0 max-w-full items-center gap-1 rounded-sm px-1 text-left text-sm transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          current ? "text-text" : "text-sub"
        )}
      >
        <User className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{current || emptyText}</span>
      </button>
    </div>
  );
}
