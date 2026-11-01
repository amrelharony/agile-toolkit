"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Clock, ListChecks, OctagonAlert, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useInlineEdit } from "@/components/shared/inline-item-editor";
import { PersonPicker } from "@/components/team/person-picker";
import type { DodCriterion } from "@/lib/stores/workspace-types";
import { cn } from "@/lib/utils";

/**
 * Who is working on a card, edited in place: the name is a button, and
 * clicking it opens the roster's PersonPicker. Nothing is saved until Save
 * (or Enter); Escape and Cancel leave the card as it was, and saving an
 * empty name clears it. Focus goes back to the name afterwards. A
 * `readOnly` card (a closed sprint's) shows the name as plain text.
 */
export function PersonInPlace({
  value,
  itemTitle,
  role,
  emptyText,
  readOnly = false,
  offerAddToRoster = true,
  onSave,
}: {
  value: string | undefined;
  /** The card's title, so each card's control has its own name. */
  itemTitle: string;
  /** "Owner" or "Assignee". */
  role: string;
  /** Shown when nobody is set: "No owner", "Unassigned". */
  emptyText: string;
  readOnly?: boolean;
  /** Offer "Add to the team" for a name off the roster; never for an example card's names. */
  offerAddToRoster?: boolean;
  onSave: (name: string) => void;
}) {
  const edit = useInlineEdit();
  const [draft, setDraft] = useState(value ?? "");
  const formRef = useRef<HTMLFormElement>(null);
  const label = `${role} of ${itemTitle}`;

  useEffect(() => {
    if (edit.editing) formRef.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, [edit.editing]);

  if (edit.editing) {
    const close = () => edit.stop({ refocus: true });
    return (
      // Escape is a convenience on top of the visible Cancel button.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
      <form
        ref={formRef}
        noValidate
        className="flex min-w-0 flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          const name = draft.trim();
          if (name !== (value ?? "").trim()) onSave(name);
          close();
        }}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.preventDefault();
          e.stopPropagation();
          close();
        }}
      >
        <PersonPicker
          label={label}
          hideLabel
          value={draft}
          onChange={setDraft}
          placeholder="Name"
          hint="Leave empty to clear."
          offerAddToRoster={offerAddToRoster}
        />
        <div className="flex flex-wrap gap-1.5">
          <Button type="submit" size="sm" className="h-8">
            Save
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-8" onClick={close}>
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  const name = value?.trim();
  if (readOnly) {
    return (
      <span
        className={cn(
          "inline-flex min-w-0 items-center gap-1 text-xs",
          name ? "text-text" : "text-sub"
        )}
      >
        <User className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="sr-only">{role}: </span>
        <span className="truncate">{name || emptyText}</span>
      </span>
    );
  }
  return (
    <button
      ref={edit.triggerRef}
      type="button"
      onClick={() => {
        setDraft(value ?? "");
        edit.start();
      }}
      title={`Change the ${role.toLowerCase()}`}
      aria-label={`${label}: ${name || emptyText.toLowerCase()}`}
      className={cn(
        "min-touch-coarse inline-flex min-w-0 items-center gap-1 rounded-sm text-left text-xs transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        name ? "text-text" : "text-sub"
      )}
    >
      <User className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{name || emptyText}</span>
    </button>
  );
}

/** "Blocked", in the danger colour and in words, so it never relies on colour alone. */
export function BlockedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-danger/40 bg-danger/10 px-1.5 py-0.5 text-xs font-medium text-danger">
      <OctagonAlert className="h-3.5 w-3.5" aria-hidden="true" />
      Blocked
    </span>
  );
}

/**
 * Flag a card as blocked, or clear the flag. The visible text says what a
 * click does; the card's title follows for screen readers, so each card's
 * button has its own name.
 */
export function BlockedToggle({
  blocked,
  itemTitle,
  onToggle,
}: {
  blocked: boolean;
  itemTitle: string;
  onToggle: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onToggle}
      className={cn(
        "min-touch-coarse h-7 gap-1 px-2 text-xs",
        blocked ? "text-danger hover:text-danger" : "text-sub hover:text-text"
      )}
    >
      <OctagonAlert aria-hidden="true" />
      {blocked ? "Unblock" : "Flag blocked"}
      <span className="sr-only">: {itemTitle}</span>
    </Button>
  );
}

/**
 * How long a card has sat in its column: "3d", or "—" when nothing says.
 * Screen readers hear it in full. `warn` tints a card that has waited long,
 * and `note` says why in words.
 */
export function AgeBadge({
  days,
  column,
  warn = false,
  note,
}: {
  days: number | null;
  column: string;
  warn?: boolean;
  note?: string;
}) {
  const base =
    days === null
      ? `Time in ${column} unknown`
      : `${days} ${days === 1 ? "day" : "days"} in ${column}`;
  const full = note ? `${base}, ${note}` : base;
  return (
    <span
      title={full}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 font-data text-xs",
        warn ? "text-warning" : "text-sub"
      )}
    >
      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
      <span aria-hidden="true">{days === null ? "—" : `${days}d`}</span>
      <span className="sr-only">{full}</span>
    </span>
  );
}

/**
 * The card's Definition of Done: "DoD 3 of 5" as a disclosure, collapsed by
 * default so a board of cards stays scannable, and inside it a checkbox per
 * criterion, required ones first. The summary says whether the required
 * ones are met, in words. A closed sprint's card shows its ticks read-only.
 * Nothing renders when the DoD has no criteria.
 */
export function DodChecklist({
  criteria,
  checked,
  itemTitle,
  readOnly = false,
  onCheck,
}: {
  criteria: readonly DodCriterion[];
  /** Ids of the criteria ticked on this card. */
  checked: ReadonlySet<string>;
  /** The card's title, so each card's controls have their own names. */
  itemTitle: string;
  readOnly?: boolean;
  onCheck: (criterionId: string, checked: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (criteria.length === 0) return null;
  const required = criteria.filter((c) => c.required);
  const ordered = [...required, ...criteria.filter((c) => !c.required)];
  const done = ordered.filter((c) => checked.has(c.id)).length;
  const requiredOpen = required.filter((c) => !checked.has(c.id)).length;
  const status =
    required.length === 0 ? "" : requiredOpen === 0 ? "met" : `${requiredOpen} required open`;
  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "min-touch-coarse inline-flex max-w-full items-center gap-1 rounded-sm text-left text-xs transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          status === "met" ? "text-success" : "text-sub"
        )}
      >
        <ListChecks className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">
          DoD {done} of {ordered.length}
          {status && ` · ${status}`}
        </span>
        <span className="sr-only">: {itemTitle}</span>
        <ChevronDown
          className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      {open && (
        <ul id={listId} className="mt-1 space-y-1" aria-label={`Definition of Done: ${itemTitle}`}>
          {ordered.map((c) => (
            <li key={c.id}>
              <label className="flex min-h-7 cursor-pointer items-start gap-2 text-xs text-text">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
                  checked={checked.has(c.id)}
                  disabled={readOnly}
                  // Every card lists the same criteria: the name says which card.
                  aria-label={`${c.label}${c.required ? "" : " (optional)"} for ${itemTitle}`}
                  onChange={(e) => onCheck(c.id, e.target.checked)}
                />
                <span className="min-w-0 break-words">
                  {c.label}
                  {!c.required && <span className="text-sub"> (optional)</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
