"use client";

import { useMemo, useRef } from "react";
import { nanoid } from "nanoid";
import { CalendarDays, Lock, NotebookPen } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { generateSmNotebookPrompts } from "@/lib/ai-prompts/sm-notebook";
import { useIsOwner } from "@/lib/auth/use-is-owner";
import type { HandoffLink } from "@/lib/handoffs/types";
import { SM_NOTEBOOK_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import {
  KIND_TAGS,
  NOTE_BODY_MAX,
  SUMMARY_TAG,
  addedLinks,
  clip,
  compareNotes,
  eventLabel,
  normalizeEntries,
  noteName,
  tagCounts,
  weekEndOf,
  weekStartOf,
} from "@/lib/notebook/model";
import { summaryNoteBody, summaryNoteTitle } from "@/lib/notebook/summary";
import { linkedToolOf } from "@/lib/notebook/tools";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { NotebookEntry } from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { todayLocalISO } from "@/lib/utils/formatters";
import { undoable } from "@/lib/utils/undoable";
import { buildExample } from "./example";
import { applyNoteValues, emptyNoteDraft, noteChanged, type NoteValues } from "./form";
import { notebookToMarkdown } from "./markdown";
import type { NoteCardProps } from "./note-card";
import { NewNoteCard, NoteForm } from "./note-form";
import { NotesView } from "./notes-view";
import { WeekView, type KeptSummary } from "./week-view";

// A stable empty list: zustand re-renders forever on a selector that
// returns a fresh array each call.
const NONE: NotebookEntry[] = [];

/**
 * Scrum Master Notebook: the coach's own dated notes on the team (the
 * workspace's notebookEntries, NotebookEntry), written fast from a form or a
 * template, tagged, from a Scrum event and about a tool. Notes read back as
 * a timeline by week with a search and tag and event filters, and one week
 * at a time with its counts and Amr's read of it (lib/notebook/summary, with
 * AI or without). A note can go on as an impediment or a retro action.
 * Notes are personal: they stay in this browser and the owner's own sync,
 * and nothing here reaches a live room.
 */
export function SmNotebookClient() {
  const hydrated = useWorkspaceHydrated();
  const raw = useWorkspaceStore((s) => s.notebookEntries) ?? NONE;
  const notes = useMemo(() => normalizeEntries(raw), [raw]);
  const today = todayLocalISO();
  const { log } = useHistoryLogger("sm-notebook");
  const announce = useAnnounce();
  // Only the owner's data leaves the browser (cloud sync is owner-only).
  const isOwner = useIsOwner();
  const captureRef = useRef<HTMLDivElement>(null);
  const knownTags = useMemo(
    () =>
      tagCounts(notes)
        .map((t) => t.tag)
        .filter((t) => !KIND_TAGS.has(t)),
    [notes]
  );

  /* ── Writes ── */

  const ws = () => useWorkspaceStore.getState();
  const fresh = (id: string) =>
    normalizeEntries(ws().notebookEntries ?? []).find((e) => e.id === id);
  // Example notes aren't the coach's history. The payload never holds a note's text.
  const record = (id: string, action: string, payload: Record<string, unknown>) => {
    if (!isExampleId(id)) log(action, payload);
  };
  const focusCapture = () =>
    requestAnimationFrame(() =>
      captureRef.current?.querySelector<HTMLElement>("textarea")?.focus()
    );

  function add(values: NoteValues) {
    const now = new Date().toISOString();
    const note = applyNoteValues(
      {
        id: `note_${nanoid(8)}`,
        date: values.date,
        body: "",
        tags: [],
        createdAt: now,
        updatedAt: now,
      },
      values,
      now
    );
    ws().upsertNotebookEntry(note);
    record(note.id, SM_NOTEBOOK_ACTIONS.NOTE_ADDED, {
      noteId: note.id,
      tags: note.tags,
      event: note.event ?? null,
    });
    announce(`Saved the note “${noteName(note, 40)}”`);
    focusCapture();
  }

  function save(note: NotebookEntry, values: NoteValues) {
    const current = fresh(note.id) ?? note;
    if (!noteChanged(current, values)) return;
    const next = applyNoteValues(current, values, new Date().toISOString());
    ws().upsertNotebookEntry(next);
    record(note.id, SM_NOTEBOOK_ACTIONS.NOTE_UPDATED, {
      noteId: note.id,
      tags: next.tags,
      event: next.event ?? null,
    });
    announce(`Saved the note “${noteName(next, 40)}”`);
    refocus(note.id);
  }

  /**
   * After an edit, focus goes back to the note's Edit button. The card does
   * that itself, unless the save moved the note (another week, out of the
   * Week view or the filters) and its card was made anew or went with the
   * form that had focus: then its Edit button where it is now, else the
   * view's heading. Ids go in no selector.
   */
  function refocus(id: string) {
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      const edit = Array.from(document.querySelectorAll<HTMLElement>("[data-note-edit]")).find(
        (b) => b.getAttribute("data-note-edit") === id
      );
      const heading = document.querySelector<HTMLElement>("[data-notebook-view-heading]");
      (edit ?? heading ?? captureRef.current?.querySelector<HTMLElement>("textarea"))?.focus();
    });
  }

  /**
   * Focus the next note's Delete button (or the one before) once `note` is
   * gone, else the new note's text: the Delete button that had focus goes
   * with the note. Ids go in no selector.
   */
  function focusPast(note: NotebookEntry) {
    const buttons = Array.from(document.querySelectorAll<HTMLElement>("[data-note-delete]"));
    const at = buttons.findIndex((b) => b.getAttribute("data-note-delete") === note.id);
    const near = at >= 0 ? (buttons[at + 1] ?? buttons[at - 1]) : undefined;
    requestAnimationFrame(() => {
      if (near?.isConnected) near.focus();
      else captureRef.current?.querySelector<HTMLElement>("textarea")?.focus();
    });
  }

  function remove(note: NotebookEntry) {
    const snapshot = fresh(note.id) ?? note;
    focusPast(note);
    undoable({
      label: `Deleted the note “${clip(noteName(snapshot), 40)}”`,
      apply: () => ws().removeNotebookEntry(note.id),
      revert: () => ws().upsertNotebookEntry(snapshot),
    });
    record(note.id, SM_NOTEBOOK_ACTIONS.NOTE_REMOVED, { noteId: note.id });
    announce(`Deleted the note “${noteName(snapshot, 40)}”`);
  }

  function setLinks(
    note: NotebookEntry,
    update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]
  ) {
    const current = fresh(note.id);
    if (!current) return;
    const next = update(current.sentTo);
    ws().upsertNotebookEntry({ ...current, sentTo: next, updatedAt: new Date().toISOString() });
    for (const link of addedLinks(current.sentTo, next)) {
      record(note.id, SM_NOTEBOOK_ACTIONS.NOTE_SENT, {
        noteId: note.id,
        route: link.route,
        targetId: link.targetId,
      });
    }
  }

  function keepSummary(kept: KeptSummary) {
    const now = new Date().toISOString();
    const end = weekEndOf(kept.weekStart);
    const note: NotebookEntry = {
      id: `note_${nanoid(8)}`,
      date: end < today ? end : today,
      title: summaryNoteTitle(kept.weekStart),
      body: summaryNoteBody(kept.summary, kept.patterns).slice(0, NOTE_BODY_MAX),
      tags: [SUMMARY_TAG],
      createdAt: now,
      updatedAt: now,
    };
    undoable({
      label: "Kept the week's summary as a note",
      // A new note destroys nothing: a success, with Undo.
      kind: "success",
      apply: () => ws().upsertNotebookEntry(note),
      revert: () => ws().removeNotebookEntry(note.id),
    });
    record(note.id, SM_NOTEBOOK_ACTIONS.SUMMARY_SAVED, {
      noteId: note.id,
      weekStart: kept.weekStart,
      source: kept.source,
      patterns: kept.patterns.length,
    });
    announce("Kept the week's summary as a note");
  }

  const loadExample = () => {
    for (const e of buildExample(today)) ws().upsertNotebookEntry(e);
  };
  const clearExample = () => {
    for (const e of ws().notebookEntries ?? []) {
      if (isExampleId(e.id)) ws().removeNotebookEntry(e.id);
    }
  };

  const cards = (note: NotebookEntry): Omit<NoteCardProps, "note"> => ({
    today,
    knownTags,
    canSend: !isExampleId(note.id),
    onSave: save,
    onRemove: remove,
    onLinksChange: setLinks,
    getLinks: (n) => fresh(n.id)?.sentTo,
  });

  /* ── Exports ── */

  const sorted = useMemo(() => [...notes].sort(compareNotes), [notes]);
  const csvData = {
    headers: ["Date", "Title", "Event", "Tags", "About", "Note", "Sent to"],
    rows: sorted.map((e) => [
      e.date,
      e.title ?? "",
      eventLabel(e.event),
      e.tags.join(", "),
      linkedToolOf(e)?.name ?? "",
      e.body,
      (e.sentTo ?? []).map((l) => l.route).join(", "),
    ]),
  };
  const markdown = notebookToMarkdown(notes);
  const weekStart = weekStartOf(today);
  const promptConfig = useMemo(
    () => ({
      toolName: "Scrum Master Notebook",
      prompts: generateSmNotebookPrompts({ entries: notes, weekStart, today }),
    }),
    [notes, weekStart, today]
  );

  return (
    <ToolPageWrapper
      toolId="sm-notebook"
      title="Scrum Master Notebook"
      description="Your own notes on the team, with patterns over the weeks."
      category="Coaching & 1:1 Frameworks"
    >
      <div className="space-y-6">
        {hasExampleItems(notes) && <ExampleNotice onClear={clearExample} />}

        <div className="flex items-start gap-2 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-xs text-text">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden="true" />
          <p>
            Your notes are saved in this browser
            {isOwner ? " and synced to your own account" : " only"}. They never go to a live room.
            They leave only when you export or share them, or ask Amr&apos;s AI about them.
          </p>
        </div>

        <div ref={captureRef}>
          <NewNoteCard>
            <NoteForm
              initial={() => emptyNoteDraft(today)}
              today={today}
              knownTags={knownTags}
              submitLabel="Save note"
              onSave={add}
            />
          </NewNoteCard>
        </div>

        {notes.length === 0 ? (
          hydrated && (
            <EmptyState icon={NotebookPen} action={<LoadExampleButton onLoad={loadExample} />}>
              No notes yet. Write one after the next Daily Scrum, retro or 1:1, or load an example
              to see a fortnight of notes, the week&apos;s counts and the patterns across them.
            </EmptyState>
          )
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-end gap-3">
              <AiPromptGenerator config={promptConfig} />
              <ExportButton
                filename="sm-notebook"
                csvData={csvData}
                jsonData={sorted}
                markdown={markdown}
              />
            </div>
            <Tabs defaultValue="notes">
              <TabsList className="mb-4 border border-border bg-surface-deep">
                <TabsTrigger value="notes" className="gap-2">
                  <NotebookPen className="h-4 w-4" aria-hidden="true" />
                  Notes
                </TabsTrigger>
                <TabsTrigger value="week" className="gap-2">
                  <CalendarDays className="h-4 w-4" aria-hidden="true" />
                  Week
                </TabsTrigger>
              </TabsList>
              <TabsContent value="notes">
                <NotesView notes={notes} today={today} cards={cards} />
              </TabsContent>
              <TabsContent value="week">
                <WeekView notes={notes} today={today} cards={cards} onKeep={keepSummary} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </ToolPageWrapper>
  );
}
