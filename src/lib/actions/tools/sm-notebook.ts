/**
 * Scrum Master Notebook — tool-local actions.
 *
 * Category: Coaching & 1:1 Frameworks
 * Tool:     A coach's own dated notes on the team, tagged by event, with
 *           weekly patterns and tools to try next.
 *
 * Agent surface: tool.sm_notebook.*
 *   1. list_state     — counts, the tags and events, this week, the newest notes.
 *   2. search         — notes by words, tags, event and days, as the page searches.
 *   3. weekly_summary — a week read without AI (the page's "Sum up this week"):
 *                       counts, repeated themes, and tools for them, each
 *                       resolved through the tool registry.
 *   4. add_note       — write a note as the page saves one (tags tidied, an
 *                       unknown linked tool dropped, times stamped).
 *   5. tag_note       — add tags to a note, each once.
 * Backing CRUD: workspace.notebook_entry.* (create, list, update, delete;
 * defineCrudActions in workspace/index.ts, which stamps createdAt/updatedAt).
 *
 * Notes are personal: they stay in the owner's workspace (this browser, and
 * the owner's sync), so every verb reads or writes only the caller's own
 * notes and none reaches a live room: visitors keep the default (`visitor`
 * true), each verb working on their own browser's notes.
 *
 * Entity kind: "workspace:notebookEntry" (NOTEBOOK_ENTRY_KIND), the kind the
 * browser sync and the CRUD use.
 */

import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverListEntities, serverUpsertEntity } from "../server-store";
import { NOTEBOOK_ENTRY_KIND, type NotebookEntry } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";
import { isExampleId } from "@/lib/utils/example-id";
import {
  NOTE_BODY_MAX,
  NOTE_EVENT_MAX,
  NOTE_TAGS_MAX,
  NOTE_TAG_MAX,
  NOTE_TITLE_MAX,
  clip,
  eventCounts,
  eventLabel,
  filterNotes,
  isDay,
  isSummaryNote,
  noteName,
  normTags,
  normalizeEntries,
  notesOfWeek,
  shiftDay,
  tagCounts,
  weekEndOf,
  weekStartOf,
} from "@/lib/notebook/model";
import { weeklyFallback, weeklyInput } from "@/lib/notebook/summary";
import {
  linkableTool,
  linkedToolOf,
  resolveSuggestedTools,
  toolNameOf,
} from "@/lib/notebook/tools";

const IsoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

const ws = () => useWorkspaceStore.getState();

/* ── The store adapter ───────────────────────────────────────────────── */

interface NotebookStore {
  all(): Promise<NotebookEntry[]>;
  get(id: string): Promise<NotebookEntry | null>;
  put(e: NotebookEntry): Promise<void>;
  /** Over MCP the server's day may be behind the user's (see latestDay). */
  onServer: boolean;
}

const browserStore: NotebookStore = {
  all: async () => normalizeEntries(ws().notebookEntries ?? []),
  get: async (id) => normalizeEntries(ws().notebookEntries ?? []).find((e) => e.id === id) ?? null,
  put: async (e) => ws().upsertNotebookEntry(e),
  onServer: false,
};

function serverStore(userId: string): NotebookStore {
  return {
    all: async () =>
      normalizeEntries(await serverListEntities<NotebookEntry>(userId, NOTEBOOK_ENTRY_KIND)),
    get: async (id) => {
      const row = await serverGetEntity<NotebookEntry>(userId, NOTEBOOK_ENTRY_KIND, id);
      return row ? (normalizeEntries([row])[0] ?? null) : null;
    },
    put: async (e) => {
      await serverUpsertEntity<NotebookEntry>(userId, NOTEBOOK_ENTRY_KIND, e);
    },
    onServer: true,
  };
}

/** The latest day a note may be about: today, or tomorrow on the server (its day may be behind the user's). */
const latestDay = (today: string, onServer: boolean) => (onServer ? shiftDay(today, 1) : today);

/** A note as the reads return it: the text cut to `bodyMax`, the linked tool by name when the registry knows it. */
function shown(e: NotebookEntry, bodyMax: number) {
  const tool = linkedToolOf(e);
  return {
    id: e.id,
    date: e.date,
    name: noteName(e),
    ...(e.title ? { title: e.title } : {}),
    body: e.body.length > bodyMax ? clip(e.body, bodyMax) : e.body,
    bodyCut: e.body.length > bodyMax,
    tags: e.tags,
    ...(e.event ? { event: e.event, eventLabel: eventLabel(e.event) } : {}),
    ...(tool ? { linkedTool: tool } : {}),
    sentTo: e.sentTo ?? [],
    ...(isExampleId(e.id) ? { example: true } : {}),
    ...(isSummaryNote(e) ? { summary: true } : {}),
  };
}

/* ── list_state ──────────────────────────────────────────────────────── */

function summarize(entries: NotebookEntry[]) {
  const today = todayLocalISO();
  const weekStart = weekStartOf(today);
  const week = notesOfWeek(entries, weekStart);
  return {
    total: entries.length,
    examples: entries.filter((e) => isExampleId(e.id)).length,
    thisWeek: {
      weekStart,
      weekEnd: weekEndOf(weekStart),
      notes: week.notes.length,
      summaries: week.summaries.length,
    },
    tags: tagCounts(entries).slice(0, 30),
    events: eventCounts(entries),
    recent: filterNotes(entries, {})
      .slice(0, 10)
      .map((e) => shown(e, 300)),
  };
}

registry.register({
  id: "tool.sm_notebook.list_state",
  toolId: "tool.sm_notebook",
  name: "list_state",
  category: "read",
  description:
    "Summarise the Scrum Master Notebook (the user's own private notes). Returns {total, examples (notes from the page's example, ids starting 'example-'), thisWeek: {weekStart (Monday), weekEnd, notes, summaries (kept weekly summaries, tagged 'weekly-summary')}, tags: [{tag, count}] (most first, up to 30), events: [{event, label, count}], recent: the 10 newest notes [{id, date, name, title?, body (cut at 300 characters; bodyCut says so), tags, event?, eventLabel?, linkedTool? {id, name, href}, sentTo, example?, summary?}]}. Use search for more.",
  paramsSchema: z.object({}),
  handler: async () => summarize(await browserStore.all()),
  mcpHandler: async (_params, ctx) => summarize(await serverStore(ctx.userId).all()),
});

/* ── search ──────────────────────────────────────────────────────────── */

const SearchSchema = z.object({
  query: z
    .string()
    .max(200)
    .optional()
    .describe("Words that must all appear in the note (title, text, tags, event or linked tool)."),
  tags: z.array(z.string().max(NOTE_TAG_MAX)).max(NOTE_TAGS_MAX).optional(),
  event: z
    .string()
    .max(NOTE_EVENT_MAX)
    .optional()
    .describe('The event id, such as "daily-scrum", "retro", "refinement" or "one-on-one".'),
  from: IsoDay.optional().describe("First day, YYYY-MM-DD, included."),
  to: IsoDay.optional().describe("Last day, YYYY-MM-DD, included."),
  limit: z.number().int().min(1).max(50).optional().describe("Default 20."),
});

async function search(store: NotebookStore, p: z.infer<typeof SearchSchema>) {
  const all = await store.all();
  const found = filterNotes(
    all,
    { query: p.query, tags: p.tags, event: p.event ?? null, from: p.from, to: p.to },
    toolNameOf
  );
  return {
    matches: found.length,
    notes: found.slice(0, p.limit ?? 20).map((e) => shown(e, 1000)),
  };
}

registry.register({
  id: "tool.sm_notebook.search",
  toolId: "tool.sm_notebook",
  name: "search",
  category: "read",
  description:
    "Find notes in the Scrum Master Notebook as the page's search does: every word of query in the title, text, tags, event or linked tool's name (ignoring case), all of tags (lower case), the event, and days from..to. Newest first. Returns {matches (how many), notes: [{id, date, name, title?, body (cut at 1000 characters; bodyCut says so), tags, event?, eventLabel?, linkedTool?, sentTo, example?, summary?}] (at most limit, default 20)}.",
  paramsSchema: SearchSchema,
  handler: async (params) => search(browserStore, params),
  mcpHandler: async (params, ctx) => search(serverStore(ctx.userId), params),
});

/* ── weekly_summary ──────────────────────────────────────────────────── */

const WeeklySchema = z.object({
  weekOf: IsoDay.optional().describe("Any day in the week (YYYY-MM-DD); default today."),
});

async function weekly(store: NotebookStore, p: z.infer<typeof WeeklySchema>) {
  const day = p.weekOf && isDay(p.weekOf) ? p.weekOf : todayLocalISO();
  const weekStart = weekStartOf(day);
  const all = await store.all();
  const { notes, summaries } = notesOfWeek(all, weekStart);
  const input = weeklyInput(all, weekStart) ?? { weekStart, notes: [] };
  const read = weeklyFallback(input);
  return {
    weekStart,
    weekEnd: weekEndOf(weekStart),
    notes: notes.length,
    tags: tagCounts(notes),
    events: eventCounts(notes),
    summary: read.summary,
    patterns: read.patterns,
    suggestedTools: resolveSuggestedTools(read.tools),
    keptSummaries: summaries.map((s) => ({ id: s.id, date: s.date, name: noteName(s) })),
    source: "fallback" as const,
  };
}

registry.register({
  id: "tool.sm_notebook.weekly_summary",
  toolId: "tool.sm_notebook",
  name: "weekly_summary",
  category: "read",
  description:
    "Read one week of the notebook together, without AI (the page's 'Sum up this week'; the page's Ask Amr can write a fuller one). The week runs Monday to Sunday around weekOf (default today); kept summaries are left out of the counts. Returns {weekStart, weekEnd, notes (count), tags: [{tag, count}], events: [{event, label, count}], summary (counts and the themes that came up most), patterns (themes in two notes or more, from tags and the notes' words), suggestedTools: [{id, name, href, why}] (only real toolkit tools), keptSummaries: [{id, date, name}], source: 'fallback'}. To keep a summary, add_note with tags ['weekly-summary'].",
  paramsSchema: WeeklySchema,
  handler: async (params) => weekly(browserStore, params),
  mcpHandler: async (params, ctx) => weekly(serverStore(ctx.userId), params),
});

/* ── add_note ────────────────────────────────────────────────────────── */

const AddNoteSchema = z.object({
  body: z.string().min(1).max(NOTE_BODY_MAX).describe("The note itself: what was seen or tried."),
  date: IsoDay.optional().describe(
    "YYYY-MM-DD, the user's local day the note is about (default today; backdating is fine, the future isn't)."
  ),
  title: z.string().max(NOTE_TITLE_MAX).optional(),
  tags: z.array(z.string().max(NOTE_TAG_MAX)).max(NOTE_TAGS_MAX).optional(),
  event: z
    .string()
    .max(NOTE_EVENT_MAX)
    .optional()
    .describe(
      'The event it came from: "sprint-planning", "daily-scrum", "refinement", "sprint-review", "retro", "one-on-one" or "day-to-day".'
    ),
  linkedTool: z
    .string()
    .max(NOTE_TITLE_MAX)
    .optional()
    .describe('The tool it is about, by tool id, such as "impediments". An unknown id is dropped.'),
});

async function addNote(store: NotebookStore, p: z.infer<typeof AddNoteSchema>) {
  const body = p.body.trim();
  if (!body) return { added: false, reason: "blank" };
  const today = todayLocalISO();
  const date = p.date ?? today;
  if (!isDay(date)) return { added: false, reason: "not_a_day" };
  if (date > latestDay(today, store.onServer)) return { added: false, reason: "future_day" };
  const tool = p.linkedTool ? linkableTool(p.linkedTool) : undefined;
  const title = p.title?.trim();
  const event = p.event?.trim();
  const now = new Date().toISOString();
  const entry: NotebookEntry = {
    id: `note_${nanoid(8)}`,
    date,
    body,
    tags: normTags(p.tags ?? []),
    ...(title ? { title } : {}),
    ...(event ? { event } : {}),
    ...(tool ? { linkedTool: tool.id } : {}),
    createdAt: now,
    updatedAt: now,
  };
  await store.put(entry);
  return {
    added: true,
    id: entry.id,
    tags: entry.tags,
    ...(p.linkedTool && !tool ? { droppedLinkedTool: p.linkedTool } : {}),
  };
}

registry.register({
  id: "tool.sm_notebook.add_note",
  toolId: "tool.sm_notebook",
  name: "add_note",
  category: "write",
  requiresConfirmation: false,
  description:
    "Write a note in the Scrum Master Notebook as the page saves one: tags tidied (trimmed, lower case, each once), the linked tool kept only when it is a real toolkit tool, created and updated times stamped. date is the user's local day (default today; backdating is fine, the future isn't; over MCP the day after the server's is taken, as the server's day may be behind the user's). Returns {added: true, id, tags, droppedLinkedTool?} or {added: false, reason: 'blank' | 'not_a_day' | 'future_day'}.",
  paramsSchema: AddNoteSchema,
  handler: async (params) => addNote(browserStore, params),
  mcpHandler: async (params, ctx) => addNote(serverStore(ctx.userId), params),
});

/* ── tag_note ────────────────────────────────────────────────────────── */

const TagNoteSchema = z.object({
  id: z.string().min(1).max(200),
  tags: z.array(z.string().max(NOTE_TAG_MAX)).min(1).max(NOTE_TAGS_MAX),
});

async function tagNote(store: NotebookStore, p: z.infer<typeof TagNoteSchema>) {
  const note = await store.get(p.id);
  if (!note) return { tagged: false, reason: "not_found" };
  const tags = normTags([...note.tags, ...p.tags]);
  if (tags.length > NOTE_TAGS_MAX)
    return { tagged: false, reason: "too_many_tags", max: NOTE_TAGS_MAX };
  const added = tags.filter((t) => !note.tags.includes(t));
  if (added.length === 0) return { tagged: true, tags, added };
  const now = new Date().toISOString();
  await store.put({ ...note, tags, createdAt: note.createdAt || now, updatedAt: now });
  return { tagged: true, tags, added };
}

registry.register({
  id: "tool.sm_notebook.tag_note",
  toolId: "tool.sm_notebook",
  name: "tag_note",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add tags to a notebook note, each once (trimmed, lower case); tags it has stay. Returns {tagged: true, tags (all of them), added (the new ones)} or {tagged: false, reason: 'not_found' | 'too_many_tags' (with max)}.",
  paramsSchema: TagNoteSchema,
  handler: async (params) => tagNote(browserStore, params),
  mcpHandler: async (params, ctx) => tagNote(serverStore(ctx.userId), params),
});
