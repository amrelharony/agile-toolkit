"use client";

/**
 * One note: its day, event, title and text, its tags (a tag filters the
 * list) and the tool it is about, with Send to… (an impediment or a retro
 * action), Edit and Delete. Editing opens the note's form in place; Cancel
 * or Escape closes it and puts focus back on Edit.
 */

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";
import { SendToMenu } from "@/components/handoff/send-to-menu";
import { IconButton } from "@/components/ui/icon-button";
import type { HandoffLink } from "@/lib/handoffs/types";
import {
  NOTE_ROUTES,
  eventLabel,
  formatShortDay,
  isDay,
  noteHandoffSource,
  noteName,
} from "@/lib/notebook/model";
import { linkedToolOf } from "@/lib/notebook/tools";
import type { NotebookEntry } from "@/lib/stores/workspace-types";
import { cn } from "@/lib/utils";
import { noteDraftFrom, type NoteValues } from "./form";
import { NoteForm } from "./note-form";

export interface NoteCardProps {
  note: NotebookEntry;
  today: string;
  knownTags: readonly string[];
  /** Example notes are never sent on. */
  canSend: boolean;
  /** Tags the list is filtered by: theirs show pressed. */
  activeTags?: readonly string[];
  onToggleTag?: (tag: string) => void;
  onSave: (note: NotebookEntry, values: NoteValues) => void;
  onRemove: (note: NotebookEntry) => void;
  onLinksChange: (
    note: NotebookEntry,
    update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]
  ) => void;
  getLinks: (note: NotebookEntry) => readonly HandoffLink[] | undefined;
}

export function NoteCard({
  note,
  today,
  knownTags,
  canSend,
  activeTags = [],
  onToggleTag,
  onSave,
  onRemove,
  onLinksChange,
  getLinks,
}: NoteCardProps) {
  const headingId = useId();
  const [editing, setEditing] = useState(false);
  const editRef = useRef<HTMLButtonElement>(null);
  const formWrap = useRef<HTMLDivElement>(null);
  const backToEdit = useRef(false);
  const name = noteName(note);
  const title = note.title?.trim();
  // A day an agent stored that the calendar doesn't have shows as written, to fix in Edit.
  const day = isDay(note.date) ? formatShortDay(note.date) : `${note.date} (not a calendar day)`;
  const when = [day, eventLabel(note.event)].filter(Boolean).join(" · ");
  const tool = linkedToolOf(note);

  useEffect(() => {
    if (editing) formWrap.current?.querySelector<HTMLElement>("textarea")?.focus();
    else if (backToEdit.current) {
      backToEdit.current = false;
      editRef.current?.focus();
    }
  }, [editing]);

  const close = () => {
    backToEdit.current = true;
    setEditing(false);
  };

  if (editing) {
    return (
      <div
        ref={formWrap}
        className="rounded-lg border border-accent/40 bg-card p-3"
        role="group"
        aria-label={`Edit note: ${name}`}
      >
        <NoteForm
          initial={() => noteDraftFrom(note)}
          today={today}
          stored={note}
          knownTags={knownTags}
          submitLabel="Save note"
          resetOnSave={false}
          onSave={(values) => {
            onSave(note, values);
            close();
          }}
          onCancel={close}
        />
      </div>
    );
  }

  return (
    <article
      aria-labelledby={headingId}
      className="rounded-lg border border-border bg-surface p-3"
      data-note={note.id}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h4 id={headingId} className="break-words text-sm font-semibold text-text">
            {title ? name : when}
          </h4>
          {title && <p className="text-xs text-sub">{when}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center">
          {canSend && (
            <SendToMenu
              routes={NOTE_ROUTES}
              item={noteHandoffSource(note)}
              sentTo={note.sentTo}
              getLinks={() => getLinks(note)}
              onLinksChange={(update) => onLinksChange(note, update)}
              itemLabels={{ impediment: "Impediment", "retro-action": "Retro action" }}
            />
          )}
          <IconButton
            ref={editRef}
            label={`Edit note: ${name}`}
            icon={<Pencil className="h-4 w-4" />}
            className="text-sub hover:text-text"
            onClick={() => setEditing(true)}
            data-note-edit={note.id}
          />
          <IconButton
            label={`Delete note: ${name}`}
            icon={<Trash2 className="h-4 w-4" />}
            className="text-sub hover:text-danger"
            onClick={() => onRemove(note)}
            data-note-delete={note.id}
          />
        </div>
      </div>

      <p className="mt-2 whitespace-pre-line break-words text-sm text-text">{note.body}</p>

      {(note.tags.length > 0 || tool) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {note.tags.map((tag) => {
            const pressed = activeTags.includes(tag);
            return onToggleTag ? (
              <button
                key={tag}
                type="button"
                aria-pressed={pressed}
                aria-label={`Tag ${tag}: ${pressed ? "stop filtering" : "show notes with it"}`}
                onClick={() => onToggleTag(tag)}
                className={cn(
                  "min-touch-coarse rounded-full border px-2 py-0.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  pressed
                    ? "border-accent/60 bg-accent/10 text-text"
                    : "border-border text-sub hover:text-text"
                )}
              >
                {tag}
              </button>
            ) : (
              <span
                key={tag}
                className="rounded-full border border-border px-2 py-0.5 text-xs text-sub"
              >
                {tag}
              </span>
            );
          })}
          {tool && (
            <Link
              href={tool.href}
              className="min-touch-coarse inline-flex items-center rounded-sm text-xs text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              About: {tool.name}
            </Link>
          )}
        </div>
      )}
    </article>
  );
}
