"use client";

import { useMemo, useState } from "react";
import { nanoid } from "nanoid";
import { ClipboardPaste, ListTodo, Lock, Send, Trash2 } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { AiButton, AiSuggestions } from "@/components/ai";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ActionRow } from "@/components/shared/action-row";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { OnSearchParams, dropSearchParam } from "@/components/shared/on-search-params";
import { SectionCard } from "@/components/shared/section-card";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { generateNotesToActionsPrompts } from "@/lib/ai-prompts/notes-to-actions";
import { notesToActionsExtractTask } from "@/lib/ai/tasks/notes-to-actions.lite";
import type { AiSource } from "@/lib/ai/task-types";
import { useIsOwner } from "@/lib/auth/use-is-owner";
import { cheer } from "@/lib/celebrate/cheer";
import { findLink, getHandoffRoute } from "@/lib/handoffs/registry";
import { sendHandoffBatch, type HandoffLinkStore } from "@/lib/handoffs/send";
import type { HandoffLink } from "@/lib/handoffs/types";
import { NOTES_TO_ACTIONS_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { groundedItems, type FoundItem } from "@/lib/notes-to-actions/extract";
import { isDay } from "@/lib/notes-to-actions/due";
import {
  KIND_LABEL,
  KIND_ONE,
  MEETING_NOTE_ID_PREFIX,
  NOTE_ITEM_ID_PREFIX,
  ROUTE_PLACE,
  alreadyKept,
  forgetText,
  isNoteDone,
  isNoteRoute,
  itemSource,
  keptItem,
  newMeetingNote,
  noteCounts,
  readMeetingNotes,
  rememberedMeeting,
  roomForItems,
  routeOf,
  withItemLinks,
} from "@/lib/notes-to-actions/model";
import { RETRO_CURRENT_ID } from "@/lib/retro/board";
import { todayIso } from "@/lib/sprints/series";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  MEETING_NOTE_ITEM_KINDS,
  TOOL_TEXT_MAX,
  type MeetingNote,
  type MeetingNoteItem,
  type MeetingNoteItemKind,
  type MeetingNoteItemStatus,
  type RetroBoard,
  type Sprint,
} from "@/lib/stores/workspace-types";
import { useTeamRoster, useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { cn } from "@/lib/utils";
import { undoable } from "@/lib/utils/undoable";
import { buildExample } from "./example";
import {
  PASTE_TOO_LONG,
  validatePaste,
  type PasteDraft,
  type PasteField,
  type PasteValues,
} from "./form";
import { ItemRow } from "./item-row";
import { notesMarkdown } from "./markdown";
import {
  findItem,
  findNote,
  currentNotes,
  patchItem,
  patchNote,
  removeNote,
  saveNote,
} from "./store";

export const TOOL_ID = "notes-to-actions";

/** Decision D4's line beside the AI button, word for word. */
export const AI_LINE =
  "Names and private details go to the AI service too. Take them out first if they shouldn't.";

const EXAMPLE_BLOCKED =
  "Example items stay here: clear the example and paste your own notes to send them on.";

const NO_SPRINTS: Sprint[] = [];
const NO_BOARDS: RetroBoard[] = [];

const nowIso = () => new Date().toISOString();
const short = (text: string, max = 40) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Whether the item a send made still exists there. */
const linkLive = (l: HandoffLink) =>
  isNoteRoute(l.route) && getHandoffRoute(l.route).exists(l.targetId);

type Found = { noteId: string; source: AiSource; items: (FoundItem & { key: string })[] };

/**
 * Notes to Actions: paste the notes from any meeting, find the actions,
 * decisions, blockers, stories, bugs and open questions in them (Amr, or
 * keyword rules without AI), keep the ones that are real, fix their words,
 * owner and due day, and send each to the tool that tracks it, with Undo:
 * actions to Retro Actions, decisions to the Decision Log as proposed,
 * blockers to Impediments, stories to the backlog, bugs to Bug Triage. A
 * question is answered or dropped. The pasted text and the lines items came
 * from can be forgotten any time; the kept items stay. Everything lives in
 * workspace.meetingNotes, which Amr's verbs and the next step read too. No
 * history payload, Markdown or prompt carries the notes' text or quotes.
 */
export function NotesToActionsClient() {
  const hydrated = useWorkspaceHydrated();
  const raw = useWorkspaceStore((s) => s.meetingNotes);
  const sprints = useWorkspaceStore((s) => s.sprints) ?? NO_SPRINTS;
  const retroBoards = useWorkspaceStore((s) => s.retroBoards) ?? NO_BOARDS;
  // Read so an item's "Sent · Open" follows its target being finished or removed.
  useWorkspaceStore((s) => s.stories);
  useWorkspaceStore((s) => s.impediments);
  useWorkspaceStore((s) => s.decisions);
  useWorkspaceStore((s) => s.bugReports);
  const roster = useTeamRoster();
  const isOwner = useIsOwner();
  const { log } = useHistoryLogger(TOOL_ID);
  const announce = useAnnounce();

  const notes = useMemo(() => readMeetingNotes(raw), [raw]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [found, setFound] = useState<Found | null>(null);
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const note = notes.find((n) => n.id === selectedId) ?? notes[0] ?? null;
  const hasExample = hasExampleItems(notes);
  const exampleOnly = notes.length > 0 && notes.every((n) => isExampleId(n.id));
  const retroOpen = retroBoards.some((b) => b.id === RETRO_CURRENT_ID);
  const sprintEnd = useMemo(() => {
    const active = sprints.find((s) => s.status === "active" && !isExampleId(s.id));
    return active && isDay(active.endDate) ? active.endDate : undefined;
  }, [sprints]);

  const markdown = useMemo(
    () => (note ? notesMarkdown(note) : "# Meeting notes\n\nNo notes yet.\n"),
    [note]
  );
  const promptConfig = useMemo(
    () => ({
      toolName: "Notes to Actions",
      prompts: note
        ? generateNotesToActionsPrompts({
            meeting: note.meeting ?? "",
            date: note.date,
            items: note.items.map((i) => ({
              kind: i.kind,
              text: i.text,
              ...(i.owner ? { owner: i.owner } : {}),
              ...(i.due ? { due: i.due } : {}),
              status: i.status,
            })),
          })
        : [],
    }),
    [note]
  );

  /* ── Changes ──────────────────────────────────────────────────────── */

  // The example's changes aren't the team's history.
  const record = (noteId: string, action: string, payload: Record<string, unknown> = {}) => {
    if (!isExampleId(noteId)) log(action, { noteId, ...payload });
  };

  /** Amr's cheer once every item of a note is sent, dropped or answered, in the tick of its log. */
  const cheerIfDone = (noteId: string, wasDone: boolean) => {
    const after = findNote(noteId);
    if (!after || wasDone || !isNoteDone(after) || isExampleId(noteId)) return;
    const { sent, dropped, answered } = noteCounts(after);
    log(NOTES_TO_ACTIONS_ACTIONS.NOTE_DONE, { noteId, sent, dropped, answered });
    cheer(TOOL_ID, "done");
    announce("Every item from these notes is dealt with.");
  };

  const addNotes = (v: PasteValues) => {
    const n = newMeetingNote(v, `${MEETING_NOTE_ID_PREFIX}${nanoid(8)}`, nowIso());
    saveNote(n);
    record(n.id, NOTES_TO_ACTIONS_ACTIONS.NOTES_ADDED, { length: n.text.length });
    setSelectedId(n.id);
    setFound(null);
    announce(
      `Saved the notes${n.meeting ? ` from ${short(n.meeting)}` : ""}. Now find the actions.`
    );
  };

  const takeFound = (n: MeetingNote, items: readonly FoundItem[], source: AiSource) => {
    const grounded = groundedItems(items, n.text, { roster, date: n.date }).filter(
      (i) => !alreadyKept(n, i)
    );
    // Sorted by kind, so the list reads in groups; each keeps the line it came from.
    const order = (k: MeetingNoteItemKind) => MEETING_NOTE_ITEM_KINDS.indexOf(k);
    const sorted = [...grounded]
      .sort((a, b) => order(a.kind) - order(b.kind))
      .map((i, k) => ({ ...i, key: `${i.kind}:${k}:${i.text}` }));
    setFound({ noteId: n.id, source, items: sorted });
    record(n.id, NOTES_TO_ACTIONS_ACTIONS.ITEMS_FOUND, {
      source: source === "ai" ? "ai" : "rules",
      count: sorted.length,
    });
    announce(
      sorted.length === 0
        ? "Nothing new to follow up in these notes."
        : `Found ${plural(sorted.length, "item")}. Keep the ones that are real.`
    );
  };

  const keep = (noteId: string, list: readonly FoundItem[]) => {
    const current = findNote(noteId);
    if (!current) return;
    const room = roomForItems(current);
    const todo = list.filter((i) => !alreadyKept(current, i)).slice(0, room);
    if (todo.length === 0) {
      announce(room === 0 ? "These notes hold 50 items, their most." : "Already kept.");
      return;
    }
    const at = nowIso();
    const kept = todo.map((i) => keptItem(i, `${NOTE_ITEM_ID_PREFIX}${nanoid(8)}`, at));
    const ids = new Set(kept.map((k) => k.id));
    const label = kept.length === 1 ? `Kept “${short(kept[0].text)}”` : `Kept ${kept.length} items`;
    undoable({
      label,
      apply: () => {
        patchNote(noteId, (n) => ({ ...n, items: [...n.items, ...kept] }));
        record(noteId, NOTES_TO_ACTIONS_ACTIONS.ITEMS_KEPT, { count: kept.length });
      },
      revert: () => {
        patchNote(noteId, (n) => ({ ...n, items: n.items.filter((i) => !ids.has(i.id)) }));
      },
    });
    announce(label);
  };

  const linkStore = (
    noteId: string,
    itemId: string,
    before: MeetingNoteItemStatus
  ): HandoffLinkStore => ({
    getLinks: () => findItem(noteId, itemId)?.sentTo,
    setLinks: (update) => {
      patchItem(noteId, itemId, (x) => withItemLinks(x, update(x.sentTo), before, linkLive));
    },
  });

  /** The links handler of one item's Send menu: a new link is logged as a send. */
  const menuLinks = (n: MeetingNote, item: MeetingNoteItem) => {
    const store = linkStore(n.id, item.id, item.status);
    return {
      getLinks: store.getLinks,
      onLinksChange: (update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]) => {
        const wasDone = isNoteDone(findNote(n.id) ?? n);
        const route = routeOf(item.kind);
        const before = route ? findLink(store.getLinks(), route) : undefined;
        store.setLinks(update);
        const after = route ? findLink(store.getLinks(), route) : undefined;
        if (route && after && after.targetId !== before?.targetId) {
          record(n.id, NOTES_TO_ACTIONS_ACTIONS.ITEMS_SENT, { route, count: 1 });
          cheerIfDone(n.id, wasDone);
        }
      },
    };
  };

  /** "Send all N": one send (and one Undo) for a kind's open items. */
  const sendAll = (n: MeetingNote, kind: MeetingNoteItemKind) => {
    const route = routeOf(kind);
    if (!route || isExampleId(n.id)) return;
    const open = n.items.filter((i) => i.kind === kind && i.status === "open");
    if (open.length === 0) return;
    const wasDone = isNoteDone(n);
    const before = new Map(open.map((i) => [i.id, findLink(i.sentTo, route)?.targetId]));
    sendHandoffBatch(
      route,
      open.map((i) => ({ src: itemSource(n, i), links: linkStore(n.id, i.id, i.status) })),
      `Sent ${plural(open.length, KIND_ONE[kind].toLowerCase())} to ${ROUTE_PLACE[route]}`
    );
    const sent = open.filter((i) => {
      const link = findLink(findItem(n.id, i.id)?.sentTo, route);
      return link && link.targetId !== before.get(i.id);
    }).length;
    if (sent > 0) {
      record(n.id, NOTES_TO_ACTIONS_ACTIONS.ITEMS_SENT, { route, count: sent });
      announce(`Sent ${plural(sent, "item")} to ${ROUTE_PLACE[route]}`);
      cheerIfDone(n.id, wasDone);
    }
  };

  /** Drop, answer or open again, with Undo. */
  const setStatus = (n: MeetingNote, item: MeetingNoteItem, status: MeetingNoteItemStatus) => {
    const prev = findItem(n.id, item.id);
    if (!prev) return;
    const wasDone = isNoteDone(findNote(n.id) ?? n);
    const label =
      status === "dropped"
        ? `Dropped “${short(item.text)}”`
        : status === "answered"
          ? `Marked “${short(item.text)}” answered`
          : `Opened “${short(item.text)}” again`;
    undoable({
      label,
      apply: () => {
        patchItem(n.id, item.id, (x) => ({ ...x, status }));
        if (status === "dropped")
          record(n.id, NOTES_TO_ACTIONS_ACTIONS.ITEM_DROPPED, { itemId: item.id, kind: item.kind });
        if (status === "answered")
          record(n.id, NOTES_TO_ACTIONS_ACTIONS.ITEM_ANSWERED, { itemId: item.id });
      },
      revert: () => {
        patchItem(n.id, item.id, () => prev);
      },
    });
    announce(label);
    if (status !== "open") cheerIfDone(n.id, wasDone);
  };

  const saveItem = (
    n: MeetingNote,
    item: MeetingNoteItem,
    v: { kind: MeetingNoteItemKind; text: string; owner?: string; due?: string; detail?: string }
  ) => {
    patchItem(n.id, item.id, (x) => {
      const next: MeetingNoteItem = { ...x, kind: v.kind, text: v.text };
      for (const k of ["owner", "due", "detail"] as const) {
        if (v[k]) next[k] = v[k];
        else delete next[k];
      }
      return next;
    });
    announce(`Saved “${short(v.text)}”`);
  };

  const forget = (n: MeetingNote) => {
    const before = findNote(n.id);
    if (!before) return;
    undoable({
      label: "Forgot the pasted notes; the items stay",
      apply: () => {
        patchNote(n.id, (x) => forgetText(x, nowIso()));
        record(n.id, NOTES_TO_ACTIONS_ACTIONS.NOTES_TEXT_FORGOTTEN);
      },
      revert: () => saveNote(before),
    });
    if (found?.noteId === n.id) setFound(null);
    announce("Forgot the pasted notes. The items you kept stay.");
  };

  const removeWholeNote = (n: MeetingNote) => {
    let removed: MeetingNote | null = null;
    const label = `Deleted the notes${n.meeting ? ` from ${short(n.meeting)}` : ""}`;
    undoable({
      label,
      apply: () => {
        removed = removeNote(n.id);
        record(n.id, NOTES_TO_ACTIONS_ACTIONS.NOTES_REMOVED);
      },
      revert: () => {
        if (removed) saveNote(removed);
      },
    });
    setSelectedId(null);
    setFound(null);
    announce(label);
  };

  const loadExample = () => {
    const ex = buildExample(todayIso());
    saveNote(ex);
    setSelectedId(ex.id);
  };
  const clearExample = () => {
    let removed: MeetingNote[] = [];
    undoable({
      label: "Cleared the example",
      apply: () => {
        removed = currentNotes()
          .filter((n) => isExampleId(n.id))
          .map((n) => removeNote(n.id))
          .filter((n): n is MeetingNote => n !== null);
      },
      revert: () => removed.forEach(saveNote),
    });
    setSelectedId(null);
    setFound(null);
  };

  const pasteForm = useItemForm<PasteDraft, PasteValues, PasteField>({
    initial: () => ({
      text: "",
      meeting: rememberedMeeting(readMeetingNotes(currentNotes())),
      date: todayIso(),
    }),
    validate: validatePaste,
    onSave: addNotes,
  });

  const onParams = (params: URLSearchParams) => {
    const id = params.get("note");
    if (!id) return;
    setSelectedId(id);
    setFound(null);
    dropSearchParam("note");
  };

  const PAGE = {
    title: "Notes to Actions",
    description:
      "Paste meeting notes to pull out actions, decisions, blockers and bugs, then send each to the tool that tracks it.",
    category: "Ceremonies",
  } as const;

  if (!hydrated) {
    return (
      <ToolPageWrapper toolId="notes-to-actions" {...PAGE}>
        <p
          role="status"
          className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-sub"
        >
          Loading your meeting notes…
        </p>
      </ToolPageWrapper>
    );
  }

  const { draft, update, errors } = pasteForm;
  const over = draft.text.length > TOOL_TEXT_MAX.paste;

  return (
    <ToolPageWrapper toolId="notes-to-actions" {...PAGE}>
      <OnSearchParams onChange={onParams} />
      <div className="space-y-4">
        {hasExample && (
          <div>
            <ExampleNotice onClear={clearExample} />
            <p className="-mt-2 text-xs text-sub">
              Example: our own Sprint Review notes from yesterday. Its items are never sent to other
              tools.
            </p>
          </div>
        )}

        <div className="flex items-start gap-2 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-xs text-text">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden="true" />
          <p>
            Your notes are saved in this browser
            {isOwner ? " and synced to your own account" : " only"}. Forget them any time: the
            pasted text and its quotes go, and the items you kept stay.
          </p>
        </div>

        <section aria-label="Paste notes">
          <SectionCard title="Paste notes" icon={ClipboardPaste}>
            <ItemForm form={pasteForm} submitLabel="Save the notes">
              <Field
                label="Meeting notes"
                required
                error={errors.text}
                hint={
                  <span className={cn(over && "text-danger")}>
                    {draft.text.length.toLocaleString("en-GB")} of{" "}
                    {TOOL_TEXT_MAX.paste.toLocaleString("en-GB")} characters
                    {over ? `. ${PASTE_TOO_LONG}` : ""}
                  </span>
                }
              >
                {(p) => (
                  <Textarea
                    {...p}
                    rows={6}
                    value={draft.text}
                    onChange={(e) => update({ text: e.target.value })}
                  />
                )}
              </Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Meeting" hint="Such as Sprint Review." error={errors.meeting}>
                  {(p) => (
                    <Input
                      {...p}
                      value={draft.meeting}
                      maxLength={TOOL_TEXT_MAX.short}
                      onChange={(e) => update({ meeting: e.target.value })}
                    />
                  )}
                </Field>
                <Field label="Day" error={errors.date} required>
                  {(p) => (
                    <Input
                      {...p}
                      type="date"
                      value={draft.date}
                      onChange={(e) => update({ date: e.target.value })}
                    />
                  )}
                </Field>
              </div>
            </ItemForm>
          </SectionCard>
        </section>

        {notes.length === 0 ? (
          <EmptyState icon={ListTodo} action={<LoadExampleButton onLoad={loadExample} />}>
            No meeting notes yet. Paste the notes from a meeting above, then find the actions,
            decisions, blockers and bugs in them and send each to the tool that tracks it.
          </EmptyState>
        ) : (
          <>
            <ActionRow>
              <AiPromptGenerator config={promptConfig} />
              <ExportButton
                filename="meeting-follow-ups"
                markdown={markdown}
                clipboardText={markdown}
                context={note ? `${note.meeting || "Meeting"} ${note.date}` : undefined}
              />
            </ActionRow>

            {note && (
              <NoteView
                key={note.id}
                note={note}
                found={found && found.noteId === note.id ? found : null}
                retroOpen={retroOpen}
                editingItem={editingItem}
                setEditingItem={setEditingItem}
                offerAddToRoster={!exampleOnly}
                aiInput={() => ({
                  notes: note.text,
                  ...(note.meeting ? { meeting: note.meeting } : {}),
                  date: note.date,
                  ...(sprintEnd ? { sprintEnd } : {}),
                })}
                onFound={(items, source) => takeFound(note, items, source)}
                onKeep={(items) => keep(note.id, items)}
                onDismissFound={() => setFound(null)}
                menuLinks={(item) => menuLinks(note, item)}
                onSendAll={(kind) => sendAll(note, kind)}
                onStatus={(item, status) => setStatus(note, item, status)}
                onSaveItem={(item, v) => saveItem(note, item, v)}
                onForget={() => forget(note)}
                onDelete={() => removeWholeNote(note)}
              />
            )}

            <section aria-labelledby="past-notes" className="space-y-2">
              <h2 id="past-notes" className="text-sm font-semibold text-text">
                Past notes ({notes.length})
              </h2>
              <ul className="space-y-1">
                {notes.map((n) => {
                  const c = noteCounts(n);
                  const current = n.id === note?.id;
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        aria-current={current ? "true" : undefined}
                        className={cn(
                          "flex min-h-11 w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-left text-sm",
                          current
                            ? "border-accent/40 bg-accent/10"
                            : "border-border bg-card hover:bg-card-hover"
                        )}
                        onClick={() => {
                          setSelectedId(n.id);
                          setFound(null);
                          setEditingItem(null);
                        }}
                      >
                        <span className="min-w-0 break-words font-medium text-text">
                          {n.meeting || "No meeting named"} · {n.date}
                        </span>
                        <span className="text-xs text-sub">
                          {c.open} open, {c.sent} sent{n.forgottenAt ? ", notes forgotten" : ""}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          </>
        )}
      </div>
    </ToolPageWrapper>
  );
}

interface NoteViewProps {
  note: MeetingNote;
  found: Found | null;
  retroOpen: boolean;
  editingItem: string | null;
  setEditingItem: (id: string | null) => void;
  offerAddToRoster: boolean;
  aiInput: () => { notes: string; meeting?: string; date: string; sprintEnd?: string };
  onFound: (items: readonly FoundItem[], source: AiSource) => void;
  onKeep: (items: readonly FoundItem[]) => void;
  onDismissFound: () => void;
  menuLinks: (item: MeetingNoteItem) => {
    getLinks: () => readonly HandoffLink[] | undefined;
    onLinksChange: (update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]) => void;
  };
  onSendAll: (kind: MeetingNoteItemKind) => void;
  onStatus: (item: MeetingNoteItem, status: MeetingNoteItemStatus) => void;
  onSaveItem: (
    item: MeetingNoteItem,
    v: { kind: MeetingNoteItemKind; text: string; owner?: string; due?: string; detail?: string }
  ) => void;
  onForget: () => void;
  onDelete: () => void;
}

/** One meeting's notes: find, keep, and the kept items by kind with their sends. */
function NoteView({
  note,
  found,
  retroOpen,
  editingItem,
  setEditingItem,
  offerAddToRoster,
  aiInput,
  onFound,
  onKeep,
  onDismissFound,
  menuLinks,
  onSendAll,
  onStatus,
  onSaveItem,
  onForget,
  onDelete,
}: NoteViewProps) {
  const example = isExampleId(note.id);
  const forgotten = !note.text.trim();
  const counts = noteCounts(note);
  const askButton = () =>
    document.querySelector<HTMLElement>("[data-find-actions] button:not([disabled])");

  return (
    <section aria-label={`${note.meeting || "Meeting"} notes, ${note.date}`} className="space-y-4">
      <SectionCard
        title={`${note.meeting || "Meeting"} · ${note.date}`}
        icon={ListTodo}
        titleSize="lg"
        actions={
          <div className="flex items-center gap-1">
            {!forgotten && (
              <Button type="button" variant="ghost" size="sm" onClick={onForget}>
                Forget the notes
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1 text-sub hover:text-danger"
              onClick={onDelete}
              aria-label={`Delete the notes from ${note.meeting || note.date}`}
            >
              <Trash2 aria-hidden="true" />
              Delete
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-text">
            {plural(counts.total, "item")} kept: {counts.open} open, {counts.sent} sent,{" "}
            {counts.answered} answered, {counts.dropped} dropped.
          </p>
          {forgotten ? (
            <p className="text-sm text-sub">
              The pasted notes were forgotten. The items kept from them stay below.
            </p>
          ) : (
            <>
              <details className="rounded-md border border-border bg-bg p-2 text-sm">
                <summary className="cursor-pointer text-sub">
                  The pasted notes ({note.text.length.toLocaleString("en-GB")} characters)
                </summary>
                <p className="mt-2 whitespace-pre-wrap break-words text-text">{note.text}</p>
              </details>
              <div className="space-y-2" data-find-actions>
                <AiButton
                  task={notesToActionsExtractTask}
                  input={aiInput}
                  onResult={(data, meta) => onFound(data.items, meta.source)}
                  label="Ask Amr to find the actions"
                  fallbackLabel="Find them without AI"
                />
                <p className="text-xs text-sub">{AI_LINE}</p>
              </div>
            </>
          )}
          {found &&
            (found.items.length > 0 ? (
              <AiSuggestions
                items={found.items}
                itemKey={(i) => i.key}
                source={found.source}
                title="Found in the notes"
                acceptLabel="Keep"
                render={(i) => ({
                  title: `${KIND_ONE[i.kind]}: ${i.text}`,
                  detail: [
                    i.owner ? `Owner ${i.owner}` : "",
                    i.due ? `due ${i.due}` : "",
                    `from “${i.quote}”`,
                  ]
                    .filter(Boolean)
                    .join(", "),
                })}
                onAccept={(i) => onKeep([i])}
                onAcceptAll={(items) => onKeep(items)}
                onDismiss={onDismissFound}
                returnFocus={askButton}
              />
            ) : (
              <p className="text-sm text-sub">Nothing new to follow up in these notes.</p>
            ))}
        </div>
      </SectionCard>

      {note.items.length === 0 ? (
        <p className="text-sm text-sub">
          No items kept yet. Find the actions above, then keep the ones that are real.
        </p>
      ) : (
        MEETING_NOTE_ITEM_KINDS.map((kind) => {
          const items = note.items.filter((i) => i.kind === kind);
          if (items.length === 0) return null;
          const route = routeOf(kind);
          const open = items.filter((i) => i.status === "open");
          return (
            <section key={kind} aria-labelledby={`kind-${kind}`} className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id={`kind-${kind}`} className="text-sm font-semibold text-text">
                  {KIND_LABEL[kind]} ({items.length})
                </h3>
                {route && open.length > 1 && !example && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    onClick={() => onSendAll(kind)}
                  >
                    <Send aria-hidden="true" />
                    Send all {open.length} to {ROUTE_PLACE[route]}
                  </Button>
                )}
              </div>
              {kind === "action" && !retroOpen && open.length > 0 && (
                <p className="text-xs text-sub">No retro is open: sending starts one.</p>
              )}
              {kind === "decision" && open.length > 0 && (
                <p className="text-xs text-sub">
                  A decision goes to the Decision Log as proposed; the team accepts it there.
                </p>
              )}
              <ul className="space-y-2" aria-label={KIND_LABEL[kind]}>
                {items.map((item) => {
                  const links = menuLinks(item);
                  return (
                    <ItemRow
                      key={item.id}
                      item={item}
                      editing={editingItem === item.id}
                      sendBlocked={example ? EXAMPLE_BLOCKED : null}
                      source={itemSource(note, item)}
                      getLinks={links.getLinks}
                      onLinksChange={links.onLinksChange}
                      offerAddToRoster={offerAddToRoster}
                      onEdit={(on) => setEditingItem(on ? item.id : null)}
                      onSave={(v) => onSaveItem(item, v)}
                      onDrop={() => onStatus(item, "dropped")}
                      onAnswer={() => onStatus(item, "answered")}
                      onReopen={() => onStatus(item, "open")}
                    />
                  );
                })}
              </ul>
            </section>
          );
        })
      )}
    </section>
  );
}
