"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Trash2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { BlurInput } from "@/components/shared/blur-fields";
import { InlineItemEditor, useInlineEdit } from "@/components/shared/inline-item-editor";
import { PersonPicker } from "@/components/team/person-picker";
import { SendToMenu } from "@/components/handoff/send-to-menu";
import type { HandoffLink } from "@/lib/handoffs/types";
import { RETRO_CARD_MAX, localDay } from "@/lib/retro/board";
import type { RetroAction } from "@/lib/retro/actions";
import { cn } from "@/lib/utils";
import { ISO_DAY, OWNER_MAX } from "./quick-add";

/** MUST match RETRO_ACTION_ROUTES in retro/components/retro-card-item.tsx. */
const ROUTES = ["impediment", "kanban"] as const;

/** Keep focus in an editor when one of its buttons is pressed, so its blur-save doesn't run first. */
const keepFocus = (e: MouseEvent) => e.preventDefault();

/**
 * The owner, edited in place: the name is a button that opens the roster's
 * PersonPicker, so the picker's notes ("isn't on the team", "Add your team
 * on the Team page") show only while someone changes it, not under every
 * row. Enter, Save or clicking away saves, and an emptied name clears it;
 * Escape and Cancel keep the old one. A name over OWNER_MAX gets quick
 * add's error and isn't saved, rather than being cut short unseen.
 */
function OwnerInPlace({
  action,
  offerAddToRoster,
  onSave,
}: {
  action: RetroAction;
  /** Never for the example: its people aren't the team's. */
  offerAddToRoster: boolean;
  onSave: (owner: string) => void;
}) {
  const edit = useInlineEdit();
  const [draft, setDraft] = useState(action.assignee);
  const formRef = useRef<HTMLFormElement>(null);
  // Enter or a button, then the blur as the form goes: only the first one counts.
  const finished = useRef(false);
  const label = `Owner of ${action.text}`;
  const name = action.assignee.trim();
  const tooLong = draft.trim().length > OWNER_MAX;
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
    if (next !== name) onSave(next);
    close(refocus);
  };

  if (edit.editing) {
    return (
      // Escape is a convenience on top of the visible Cancel button.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
      <form
        ref={formRef}
        noValidate
        className="flex w-full min-w-0 flex-col gap-1.5 sm:w-56"
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
        {/* "Add to the team" fills in the name, and its note goes with the
            click: a press keeps focus in the input, and a keyboard press
            hands it back there. */}
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
            hideLabel
            placeholder="Owner"
            value={draft}
            onChange={setDraft}
            hint="Leave empty to clear."
            error={tooLong ? `Keep the name to ${OWNER_MAX} characters.` : undefined}
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
    <button
      ref={edit.triggerRef}
      type="button"
      onClick={() => {
        setDraft(action.assignee);
        finished.current = false;
        edit.start();
      }}
      title="Change the owner"
      aria-label={`${label}: ${name || "No owner"}`}
      className={cn(
        "min-touch-coarse inline-flex h-9 min-w-0 max-w-full items-center gap-1 rounded-sm px-1 text-left text-xs transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:max-w-44",
        name ? "text-text" : "text-sub"
      )}
    >
      <User className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{name || "No owner"}</span>
    </button>
  );
}

/**
 * "Done <day>", which can be moved back: ticking Done stamps today, but an
 * action finished on Friday and ticked on Monday should read Friday. The
 * day is a button; Enter or clicking away saves, Escape keeps it. A day
 * after today isn't saved, and neither is an emptied field.
 */
function DoneDay({
  action,
  day,
  today,
  onSave,
}: {
  action: RetroAction;
  /** The local day it was marked done. */
  day: string;
  /** YYYY-MM-DD, local: the latest day it can have been done. */
  today: string;
  onSave: (day: string) => void;
}) {
  const edit = useInlineEdit();
  const [draft, setDraft] = useState(day);
  const inputRef = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const error =
    draft && !ISO_DAY.test(draft)
      ? "Pick a day."
      : draft > today
        ? "Pick today or an earlier day."
        : undefined;

  useEffect(() => {
    if (edit.editing) inputRef.current?.focus();
  }, [edit.editing]);

  const close = (refocus: boolean) => {
    finished.current = true;
    edit.stop({ refocus });
  };
  const save = (refocus: boolean) => {
    if (finished.current || error) return;
    if (draft && draft !== day) onSave(draft);
    close(refocus);
  };

  if (edit.editing) {
    return (
      <Field
        label={`Day “${action.text}” was done`}
        hideLabel
        error={error}
        className="mt-1 w-44 gap-1"
      >
        {(props) => (
          <Input
            {...props}
            ref={inputRef}
            type="date"
            max={today}
            className="h-9"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => save(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save(true);
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                close(true);
              }
            }}
          />
        )}
      </Field>
    );
  }

  return (
    <button
      ref={edit.triggerRef}
      type="button"
      onClick={() => {
        setDraft(day);
        finished.current = false;
        edit.start();
      }}
      title="Change the day it was done"
      aria-label={`Done ${day}: change the day “${action.text}” was done`}
      className="rounded-sm underline decoration-dotted underline-offset-2 transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
    >
      {`Done ${day}`}
    </button>
  );
}

export interface ActionRowProps {
  action: RetroAction;
  /** The page shows the example: nothing is carried over, sent anywhere or added to the team. */
  preview: boolean;
  /** YYYY-MM-DD, local. */
  today: string;
  /** Move focus to this row's text, e.g. onto a carried copy whose original row just went. */
  takeFocus?: boolean;
  onFocusTaken?: () => void;
  onDone: (action: RetroAction, done: boolean) => void;
  /** A done day picked by hand (YYYY-MM-DD, not after today). */
  onDoneDay: (action: RetroAction, day: string) => void;
  onText: (action: RetroAction, text: string) => void;
  onOwner: (action: RetroAction, owner: string) => void;
  onDueDate: (action: RetroAction, dueDate: string | undefined) => void;
  onCarryOver: (action: RetroAction) => void;
  /** Delete it from its board (with Undo): a mistaken or doubled quick add, on any retro. */
  onDelete: (action: RetroAction) => void;
  onLinksChange: (
    action: RetroAction,
    update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]
  ) => void;
}

/**
 * One action: done (and the day it was done), its text (click to edit in
 * place), owner, due date, and for a past retro's open action, Carry over;
 * Send to… hands it to the impediments log or the Kanban board, and Delete
 * takes it off its board.
 */
export function ActionRow({
  action: a,
  preview,
  today,
  takeFocus = false,
  onFocusTaken,
  onDone,
  onDoneDay,
  onText,
  onOwner,
  onDueDate,
  onCarryOver,
  onDelete,
  onLinksChange,
}: ActionRowProps) {
  const edit = useInlineEdit();
  const doneDay = a.done && !a.closedByTarget ? localDay(a.doneAt) : null;

  useEffect(() => {
    if (!takeFocus) return;
    edit.triggerRef.current?.focus();
    onFocusTaken?.();
  }, [takeFocus, edit.triggerRef, onFocusTaken]);

  return (
    <li className="flex flex-wrap items-start gap-3 px-3 py-2">
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
        checked={a.done}
        disabled={a.closedByTarget}
        aria-label={`Done: ${a.text}`}
        onChange={(e) => onDone(a, e.target.checked)}
      />
      <div className="min-w-0 flex-1 basis-56">
        {edit.editing ? (
          <InlineItemEditor
            label="Edit action"
            title={a.text}
            titleLabel="Action text"
            titleMaxLength={RETRO_CARD_MAX}
            onDone={(next, { refocus }) => {
              edit.stop({ refocus });
              if (next) onText(a, next.title);
            }}
          />
        ) : (
          <button
            ref={edit.triggerRef}
            type="button"
            onClick={edit.start}
            title="Click to edit"
            className={cn(
              "block w-full cursor-text break-words rounded-sm text-left text-sm transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
              a.done ? "text-sub line-through" : "text-text"
            )}
          >
            <span>{a.text}</span>
            <span className="sr-only"> (edit)</span>
          </button>
        )}
        <div className="text-xs text-sub">
          {a.overdue && <span className="font-medium text-warning">Overdue · </span>}
          {a.closedByTarget && <span className="text-success">Done in the linked tool · </span>}
          {a.carriedFrom && "Carried over · "}
          {doneDay ? (
            <DoneDay action={a} day={doneDay} today={today} onSave={(day) => onDoneDay(a, day)} />
          ) : a.current ? (
            "This retro"
          ) : (
            "Past retro"
          )}
        </div>
      </div>
      <div className="flex w-full flex-wrap items-start gap-2 sm:w-auto">
        <OwnerInPlace
          action={a}
          offerAddToRoster={!preview}
          onSave={(owner) => onOwner(a, owner)}
        />
        {/* Saved when the field is left or on Enter: typing a year passes
            through 0002, 0020 and 0202, which would each be a saved edit
            (and briefly an overdue action). */}
        <BlurInput
          type="date"
          aria-label={`Due date of ${a.text}`}
          className="h-9 w-40"
          value={a.dueDate ?? ""}
          onCommit={(next) => onDueDate(a, next ? next : undefined)}
        />
        {!a.current && !a.done && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 px-2 text-xs"
            disabled={preview}
            aria-label={`Carry over ${a.text} to the current retro`}
            onClick={() => onCarryOver(a)}
          >
            Carry over
          </Button>
        )}
        <SendToMenu
          routes={ROUTES}
          disabled={preview}
          item={{
            title: a.text,
            owner: a.assignee || undefined,
            sourceRef: { tool: "retro", id: a.id, doc: a.boardId },
          }}
          sentTo={a.sentTo}
          onLinksChange={(update) => onLinksChange(a, update)}
          className="h-9"
        />
        <IconButton
          label={`Delete ${a.text}`}
          icon={<Trash2 className="h-4 w-4" />}
          className="h-9 w-9 text-sub hover:text-danger"
          onClick={() => onDelete(a)}
        />
      </div>
    </li>
  );
}
