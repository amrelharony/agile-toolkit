"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InlineItemEditor, useInlineEdit } from "@/components/shared/inline-item-editor";
import { PersonPicker } from "@/components/team/person-picker";
import { SendToMenu } from "@/components/handoff/send-to-menu";
import type { HandoffLink } from "@/lib/handoffs/types";
import { RETRO_CARD_MAX, localDay } from "@/lib/retro/board";
import type { RetroAction } from "@/lib/retro/actions";
import { cn } from "@/lib/utils";
import { OWNER_MAX } from "./quick-add";

/** MUST match RETRO_ACTION_ROUTES in retro/components/retro-card-item.tsx. */
const ROUTES = ["impediment", "kanban"] as const;

/**
 * The owner, picked from the roster on a draft that is saved when focus
 * leaves the picker or on Enter; Escape puts the saved name back. Picking
 * "Add to the team" saves at once: that click is a choice, and the note
 * holding it disappears with the click, taking focus with it.
 */
function OwnerCell({ action, onSave }: { action: RetroAction; onSave: (owner: string) => void }) {
  const [draft, setDraft] = useState(action.assignee);
  // The draft as of the last change, for a save in the same event as the change.
  const latest = useRef(action.assignee);
  useEffect(() => {
    latest.current = action.assignee;
    setDraft(action.assignee);
  }, [action.assignee]);
  const change = (name: string) => {
    latest.current = name;
    setDraft(name);
  };
  const commit = () => {
    const next = latest.current.trim().slice(0, OWNER_MAX);
    if (next !== action.assignee.trim()) onSave(next);
  };
  return (
    // Blur, Enter and the note's button all bubble up from PersonPicker,
    // which owns the input; the input and button are the interactive parts.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      className="w-full sm:w-44"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) commit();
      }}
      onKeyDown={(e) => {
        if (!(e.target instanceof HTMLInputElement)) return;
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          change(action.assignee);
        }
      }}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) commit();
      }}
    >
      <PersonPicker
        label={`Owner of ${action.text}`}
        hideLabel
        placeholder="Owner"
        value={draft}
        onChange={change}
      />
    </div>
  );
}

export interface ActionRowProps {
  action: RetroAction;
  /** The page shows the example: nothing is carried over or sent anywhere. */
  preview: boolean;
  onDone: (action: RetroAction, done: boolean) => void;
  onText: (action: RetroAction, text: string) => void;
  onOwner: (action: RetroAction, owner: string) => void;
  onDueDate: (action: RetroAction, dueDate: string | undefined) => void;
  onCarryOver: (action: RetroAction) => void;
  onLinksChange: (
    action: RetroAction,
    update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]
  ) => void;
}

/**
 * One action: done, its text (click to edit in place), owner, due date,
 * and for a past retro's open action, Carry over; Send to… hands it to the
 * impediments log or the Kanban board.
 */
export function ActionRow({
  action: a,
  preview,
  onDone,
  onText,
  onOwner,
  onDueDate,
  onCarryOver,
  onLinksChange,
}: ActionRowProps) {
  const edit = useInlineEdit();
  const doneDay = a.done && !a.closedByTarget ? localDay(a.doneAt) : null;
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
      <span className="min-w-0 flex-1 basis-56">
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
        <span className="block text-xs text-sub">
          {a.overdue && <span className="font-medium text-warning">Overdue · </span>}
          {a.closedByTarget && <span className="text-success">Done in the linked tool · </span>}
          {a.carriedFrom && "Carried over · "}
          {doneDay ? `Done ${doneDay}` : a.current ? "This retro" : "Past retro"}
        </span>
      </span>
      <div className="flex w-full flex-wrap items-start gap-2 sm:w-auto">
        <OwnerCell action={a} onSave={(owner) => onOwner(a, owner)} />
        <Input
          type="date"
          aria-label={`Due date of ${a.text}`}
          className="h-9 w-40"
          value={a.dueDate ?? ""}
          onChange={(e) => onDueDate(a, e.target.value ? e.target.value : undefined)}
        />
        {!a.current && !a.done && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 px-2 text-xs"
            disabled={preview}
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
      </div>
    </li>
  );
}
