/**
 * Notes to Actions' pure model, server-safe: where each kind of item goes
 * (an action to Retro Actions, a decision to the Decision Log as proposed,
 * a blocker to Impediments, a story to the backlog, a bug to Bug Triage; a
 * question is answered or dropped, never sent), what a send hands over,
 * forgetting the pasted text, the counts, a defensive reader for stored
 * rows, and the page's next step. The page, Amr's verbs and the next-step
 * rule all read it. Pure: no store, no React, no "use client" module.
 */

import {
  MEETING_NOTE_ITEM_KINDS,
  MEETING_NOTE_ITEM_STATUSES,
  TOOL_LIST_MAX,
  TOOL_TEXT_MAX,
  type HandoffLink,
  type HandoffRouteId,
  type MeetingNote,
  type MeetingNoteItem,
  type MeetingNoteItemKind,
  type MeetingNoteItemStatus,
} from "@/lib/stores/workspace-types";
import type { HandoffSource } from "@/lib/handoffs/types";
import type { NextStep } from "@/lib/tools/next-steps";
import { isExampleId } from "@/lib/utils/example-id";
import { isDay } from "./due";
import { normalized, type FoundItem } from "./extract";

/** Every meeting note's id starts with this (the workspace.meeting_note CRUD's). */
export const MEETING_NOTE_ID_PREFIX = "mnote_";
/** A kept item's id. */
export const NOTE_ITEM_ID_PREFIX = "mitem_";

/** An open item waits this long before the next step asks to send it. */
export const OPEN_ITEM_DAYS = 1;

/** The kinds that are sent somewhere: every kind but a question. */
export type SentKind = Exclude<MeetingNoteItemKind, "question">;

/** Where each kind goes. A question is answered or dropped, never sent. */
export const ROUTES_BY_KIND: Readonly<Record<SentKind, HandoffRouteId>> = {
  action: "retro-action",
  decision: "decision",
  impediment: "impediment",
  story: "backlog-story",
  bug: "bug",
};

/** The routes an item can take, in the page's order. */
export const NOTE_ROUTES = [
  "retro-action",
  "decision",
  "impediment",
  "backlog-story",
  "bug",
] as const satisfies readonly HandoffRouteId[];
export type NoteRoute = (typeof NOTE_ROUTES)[number];

export const isNoteRoute = (route: string): route is NoteRoute =>
  (NOTE_ROUTES as readonly string[]).includes(route);

/** The route a kind takes, or null for a question. */
export const routeOf = (kind: MeetingNoteItemKind): NoteRoute | null =>
  kind === "question" ? null : (ROUTES_BY_KIND[kind] as NoteRoute);

/** Each kind's name, as the page groups items. */
export const KIND_LABEL: Record<MeetingNoteItemKind, string> = {
  action: "Actions",
  decision: "Decisions",
  impediment: "Blockers",
  story: "Stories",
  bug: "Bugs",
  question: "Open questions",
};

/** One of each kind, for a select. */
export const KIND_ONE: Record<MeetingNoteItemKind, string> = {
  action: "Action",
  decision: "Decision",
  impediment: "Blocker",
  story: "Story",
  bug: "Bug",
  question: "Question",
};

/** Where a route lands, as a sentence ends: "Sent to Retro Actions". */
export const ROUTE_PLACE: Record<NoteRoute, string> = {
  "retro-action": "Retro Actions",
  decision: "the Decision Log",
  impediment: "Impediments",
  "backlog-story": "the backlog",
  bug: "Bug Triage",
};

const capped = (text: string | undefined, max: number) => {
  const t = (text ?? "").trim().slice(0, max);
  return t === "" ? undefined : t;
};

/**
 * What a send hands over for a kept item: its words as the title, its
 * detail, the owner and due date for an action, and where it lives (the
 * item, on its note), so the target links back. A decision goes as a
 * proposal: what the meeting agreed is its recommendation, and the team
 * accepts it in the Decision Log. The quote is never sent.
 */
export function itemSource(
  note: Pick<MeetingNote, "id" | "meeting">,
  item: Pick<MeetingNoteItem, "id" | "kind" | "text" | "detail" | "owner" | "due">
): HandoffSource {
  const detail = capped(item.detail, TOOL_TEXT_MAX.text);
  const owner = capped(item.owner, TOOL_TEXT_MAX.short);
  return {
    title: item.text.trim(),
    ...(detail ? { description: detail } : {}),
    ...(owner ? { owner } : {}),
    ...(item.kind === "action" && isDay(item.due) ? { due: item.due } : {}),
    ...(item.kind === "decision" ? { decision: { recommendation: item.text.trim() } } : {}),
    sourceRef: { tool: "notes-to-actions", id: item.id, doc: note.id },
  };
}

/** A new note from pasted text, with no items yet. */
export function newMeetingNote(
  values: { text: string; meeting?: string; date: string },
  id: string,
  at: string
): MeetingNote {
  const meeting = capped(values.meeting, TOOL_TEXT_MAX.short);
  return {
    id,
    date: values.date,
    text: values.text.slice(0, TOOL_TEXT_MAX.paste),
    ...(meeting ? { meeting } : {}),
    items: [],
    createdAt: at,
    updatedAt: at,
  };
}

/** A found item, kept: open, stamped, within the caps. */
export function keptItem(found: FoundItem, id: string, at: string): MeetingNoteItem {
  const detail = capped(found.detail, TOOL_TEXT_MAX.text);
  const owner = capped(found.owner, TOOL_TEXT_MAX.short);
  const quote = capped(found.quote, TOOL_TEXT_MAX.short);
  return {
    id,
    kind: found.kind,
    text: found.text.trim().slice(0, TOOL_TEXT_MAX.short),
    ...(detail ? { detail } : {}),
    ...(owner ? { owner } : {}),
    ...(isDay(found.due) ? { due: found.due } : {}),
    ...(quote ? { quote } : {}),
    status: "open",
    keptAt: at,
  };
}

/** How many more items a note can keep. */
export const roomForItems = (note: Pick<MeetingNote, "items">) =>
  Math.max(0, TOOL_LIST_MAX.noteItems - note.items.length);

/**
 * The note with the pasted text forgotten: the text goes, and every quote
 * with it; the items kept (and their details) stay.
 */
export function forgetText(note: MeetingNote, at: string): MeetingNote {
  return {
    ...note,
    text: "",
    forgottenAt: at,
    items: note.items.map((item) => {
      const next = { ...item };
      delete next.quote;
      return next;
    }),
  };
}

/**
 * Whether a found item is already kept on the note: one of the same kind
 * with the same words, or from the same line of the notes while the kept
 * item still has its quote. The line catches an item edited after it was
 * kept, and one kept in the AI's words then found again by the rules (or
 * the other way round).
 */
export function alreadyKept(note: Pick<MeetingNote, "items">, found: FoundItem): boolean {
  const words = normalized(found.text);
  const line = found.quote ? normalized(found.quote) : "";
  return note.items.some(
    (i) =>
      i.kind === found.kind &&
      (normalized(i.text) === words || (line !== "" && !!i.quote && normalized(i.quote) === line))
  );
}

export interface NoteCounts {
  total: number;
  open: number;
  sent: number;
  dropped: number;
  answered: number;
}

export function noteCounts(note: Pick<MeetingNote, "items">): NoteCounts {
  const counts: NoteCounts = {
    total: note.items.length,
    open: 0,
    sent: 0,
    dropped: 0,
    answered: 0,
  };
  for (const item of note.items) counts[item.status]++;
  return counts;
}

/** Every item is sent, dropped or answered (and there is at least one). */
export const isNoteDone = (note: Pick<MeetingNote, "items">) =>
  note.items.length > 0 && note.items.every((i) => i.status !== "open");

/**
 * An item's links after a send or its Undo: it turns "sent" with its first
 * link whose target is still there, and goes back to `before` (its status
 * before the send) when none is.
 */
export function withItemLinks(
  item: MeetingNoteItem,
  links: HandoffLink[],
  before: MeetingNoteItemStatus,
  live: (l: HandoffLink) => boolean
): MeetingNoteItem {
  const next: MeetingNoteItem = { ...item, sentTo: links.length > 0 ? links : undefined };
  if (!next.sentTo) delete next.sentTo;
  next.status = links.some(live) ? "sent" : before === "sent" ? "open" : before;
  return next;
}

/** The meeting the next note offers: the newest note's. */
export function rememberedMeeting(notes: readonly MeetingNote[]): string {
  const newest = [...notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return newest?.meeting ?? "";
}

/* ── Reading stored rows ──────────────────────────────────────────────── */

const str = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? undefined : t.slice(0, max);
};
const time = (v: unknown): string | undefined =>
  typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : undefined;

function readLinks(raw: unknown): HandoffLink[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const links = raw.filter(
    (l): l is HandoffLink =>
      !!l &&
      typeof l === "object" &&
      typeof (l as HandoffLink).route === "string" &&
      typeof (l as HandoffLink).targetId === "string" &&
      typeof (l as HandoffLink).at === "string"
  );
  return links.length > 0 ? links : undefined;
}

function readItem(raw: unknown, fallbackAt: string): MeetingNoteItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 64);
  const text = str(r.text, TOOL_TEXT_MAX.short);
  const kind = (MEETING_NOTE_ITEM_KINDS as readonly unknown[]).includes(r.kind)
    ? (r.kind as MeetingNoteItemKind)
    : null;
  if (!id || !text || !kind) return null;
  const status = (MEETING_NOTE_ITEM_STATUSES as readonly unknown[]).includes(r.status)
    ? (r.status as MeetingNoteItemStatus)
    : "open";
  const detail = str(r.detail, TOOL_TEXT_MAX.text);
  const owner = str(r.owner, TOOL_TEXT_MAX.short);
  const quote = str(r.quote, TOOL_TEXT_MAX.short);
  const due = typeof r.due === "string" && isDay(r.due) ? r.due : undefined;
  const sentTo = readLinks(r.sentTo);
  return {
    id,
    kind,
    text,
    status,
    keptAt: time(r.keptAt) ?? fallbackAt,
    ...(detail ? { detail } : {}),
    ...(owner ? { owner } : {}),
    ...(due ? { due } : {}),
    ...(quote ? { quote } : {}),
    ...(sentTo ? { sentTo } : {}),
  };
}

/** One stored note as the page reads it, or null when it can't be read. */
export function readMeetingNote(raw: unknown): MeetingNote | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 200);
  const date = typeof r.date === "string" && isDay(r.date) ? r.date : undefined;
  if (!id || !date) return null;
  const createdAt = time(r.createdAt) ?? new Date(0).toISOString();
  const meeting = str(r.meeting, TOOL_TEXT_MAX.short);
  const forgottenAt = time(r.forgottenAt);
  const items = (Array.isArray(r.items) ? r.items : [])
    .map((i) => readItem(i, createdAt))
    .filter((i): i is MeetingNoteItem => i !== null)
    .slice(0, TOOL_LIST_MAX.noteItems);
  return {
    id,
    date,
    // A forgotten note keeps no text, whatever a stale row says.
    text: forgottenAt ? "" : typeof r.text === "string" ? r.text.slice(0, TOOL_TEXT_MAX.paste) : "",
    items: forgottenAt
      ? items.map((i) => {
          const next = { ...i };
          delete next.quote;
          return next;
        })
      : items,
    createdAt,
    updatedAt: time(r.updatedAt) ?? createdAt,
    ...(meeting ? { meeting } : {}),
    ...(forgottenAt ? { forgottenAt } : {}),
  };
}

/** Every readable note, newest meeting first (then newest pasted). */
export function readMeetingNotes(raw: readonly unknown[] | undefined): MeetingNote[] {
  return (raw ?? [])
    .map(readMeetingNote)
    .filter((n): n is MeetingNote => n !== null)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

/** A note's page link. */
export const noteHref = (id: string) => `/notes-to-actions?note=${encodeURIComponent(id)}`;

/** A note's name: its meeting, or the day. */
export const noteName = (note: Pick<MeetingNote, "meeting" | "date">) =>
  note.meeting ? `${note.meeting} notes` : `the notes of ${note.date}`;

/* ── Next steps ──────────────────────────────────────────────────────── */

/** What the rule reads from the workspace. */
export interface NotesToActionsStepsInput {
  notes: readonly MeetingNote[] | undefined;
}

const DAY_MS = 86_400_000;

/**
 * Notes to Actions' next step, given the time now: the note whose items
 * have waited longest, when any kept item has stayed open for more than a
 * day: "Send the N open items from <meeting> notes". The team's own notes
 * only.
 */
export function notesToActionsSteps(s: NotesToActionsStepsInput, now: Date): NextStep[] {
  const cutoff = now.getTime() - OPEN_ITEM_DAYS * DAY_MS;
  const waiting = readMeetingNotes(s.notes)
    .filter((n) => !isExampleId(n.id))
    .map((n) => {
      const open = n.items.filter((i) => i.status === "open");
      const oldest = open.reduce(
        (min, i) => Math.min(min, Date.parse(i.keptAt) || Infinity),
        Infinity
      );
      return { note: n, open: open.length, oldest };
    })
    .filter((x) => x.open > 0 && x.oldest < cutoff)
    .sort((a, b) => a.oldest - b.oldest)[0];
  if (!waiting) return [];
  const { note, open } = waiting;
  return [
    {
      id: "notes-to-actions-send",
      label: `Send the ${open} open ${open === 1 ? "item" : "items"} from ${noteName(note)}`,
      detail: "Kept items wait here until each is sent, answered or dropped.",
      href: noteHref(note.id),
    },
  ];
}
