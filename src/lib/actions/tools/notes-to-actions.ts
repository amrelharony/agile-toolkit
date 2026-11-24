/**
 * Notes to Actions — tool-local actions.
 *
 * Category: Ceremonies
 *
 * Agent surface: tool.notes_to_actions.*
 *   1. list_state  — the notes (newest meeting first) with their meeting,
 *                    day, the pasted text's length (never the text) and
 *                    counts, and the kept items without their quotes, each
 *                    link with its target's state.
 *   2. add_notes   — paste a meeting's notes.
 *   3. find_items  — what the page's rules find in a note's text, with the
 *                    line each came from. Read only: nothing is kept.
 *   4. keep_items  — keep found items on the note.
 *   5. send        — send a kept item where its kind goes, as the page does.
 *   6. drop / answer — drop an open item, or mark a question answered.
 *   7. forget_text — clear the pasted text and the quotes, keeping the items.
 * Backing CRUD: workspace.meeting_note.* (create, list, update, delete).
 *
 * Over MCP every write is the user's rows on the server: decisions through
 * ./decision-log's server store (createRecord gives the next number), the
 * other targets as Parking Lot writes them. Only single targets are
 * imported, never the hand-off registry, `send` or targets/decision.ts
 * (they reach browser-only modules the MCP route must not load). Example
 * notes are never sent.
 */

import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import { serverListEntities, serverUpsertEntity } from "../server-store";
import {
  browserDecisionStore,
  createRecord,
  newRecordId,
  serverDecisionStore,
  type DecisionStore,
} from "./decision-log";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  BUG_REPORT_KIND,
  MEETING_NOTE_ITEM_KINDS,
  MEETING_NOTE_KIND,
  TOOL_TEXT_MAX,
  type BugReport,
  type HandoffLink,
  type Impediment,
  type MeetingNote,
  type MeetingNoteItem,
  type RetroBoard,
  type Sprint,
  type Story,
  type TeamMember,
} from "@/lib/stores/workspace-types";
import { withLink } from "@/lib/handoffs/links";
import type { HandoffRoute, HandoffSource } from "@/lib/handoffs/types";
import { backlogStoryRoute, buildBacklogStory } from "@/lib/handoffs/targets/backlog-story";
import { bugRoute, buildBugReport } from "@/lib/handoffs/targets/bug";
import { buildImpediment, impedimentRoute } from "@/lib/handoffs/targets/impediment";
import { retroActionRoute } from "@/lib/handoffs/targets/retro-action";
import { buildRetroCard } from "@/lib/handoffs/targets/retro-board";
import { buildDecision, decisionHref, isDecided } from "@/lib/decisions/model";
import { isResolved } from "@/lib/impediments/model";
import { stampStoryWrite } from "@/lib/sprints/story-status";
import { todayIso } from "@/lib/sprints/series";
import { cleanStoryFields } from "@/lib/stories/fields";
import { retroFormats } from "@/lib/constants/retro-formats";
import { RETRO_CURRENT_ID, blankRetroBoard, newestArchivedRetro } from "@/lib/retro/board";
import { findRosterMember } from "@/lib/team/names";
import { isExampleId } from "@/lib/utils/example-id";
import { isDay } from "@/lib/notes-to-actions/due";
import { extractByRules, normalized, type FoundItem } from "@/lib/notes-to-actions/extract";
import {
  KIND_ONE,
  MEETING_NOTE_ID_PREFIX,
  NOTE_ITEM_ID_PREFIX,
  NOTE_ROUTES,
  ROUTE_PLACE,
  alreadyKept,
  forgetText,
  isNoteDone,
  isNoteRoute,
  itemSource,
  keptItem,
  newMeetingNote,
  noteCounts,
  readMeetingNote,
  readMeetingNotes,
  roomForItems,
  routeOf,
  type NoteRoute,
} from "@/lib/notes-to-actions/model";

/** MUST match registerCollection(…) in workspace-store.ts. */
const KIND_STORY = "workspace:story";
const KIND_IMPEDIMENT = "workspace:impediment";
const KIND_RETRO = "workspace:retroBoard";
const KIND_SPRINT = "workspace:sprint";
const KIND_MEMBER = "workspace:teamMember";

const ws = () => useWorkspaceStore.getState();

type Out = Record<string, unknown>;
type TargetState = "gone" | "live" | "done";

/** The routes the browser sends by itself (a decision goes through the decision store). */
const ROUTES: Readonly<Record<Exclude<NoteRoute, "decision">, HandoffRoute>> = {
  "retro-action": retroActionRoute,
  impediment: impedimentRoute,
  "backlog-story": backlogStoryRoute,
  bug: bugRoute,
};

/** Where the notes (and the items they were sent to) live: the browser, or the server. */
interface NotesStore {
  notes(): Promise<MeetingNote[]>;
  put(note: MeetingNote): Promise<void>;
  target(link: HandoffLink): Promise<TargetState>;
  send(route: NoteRoute, src: HandoffSource): Promise<string>;
  roster(): Promise<TeamMember[]>;
  sprints(): Promise<Sprint[]>;
}

async function decisionState(store: DecisionStore, id: string): Promise<TargetState> {
  const d = (await store.list()).records.find((r) => r.id === id);
  return !d ? "gone" : isDecided(d.status) ? "done" : "live";
}

const browserStore: NotesStore = {
  notes: async () => ws().meetingNotes ?? [],
  put: async (note) => ws().upsertMeetingNote(note),
  target: async (link) => {
    if (!isNoteRoute(link.route)) return "gone";
    if (link.route === "decision") return decisionState(browserDecisionStore, link.targetId);
    const route = ROUTES[link.route];
    if (!route.exists(link.targetId)) return "gone";
    return route.isDone?.(link.targetId) ? "done" : "live";
  },
  // The routes themselves, as the page's sends call them (no toast: an agent has no Undo).
  send: async (route, src) =>
    route === "decision"
      ? (await createRecord(browserDecisionStore, buildDecision(src, newRecordId()))).id
      : ROUTES[route].send(src),
  roster: async () => ws().teamMembers ?? [],
  sprints: async () => ws().sprints ?? [],
};

function serverStore(userId: string): NotesStore {
  const decisions = serverDecisionStore(userId);
  // Each target collection is read once per call (list_state checks every link).
  const cache = new Map<string, Promise<unknown[]>>();
  const list = <T extends { id: string }>(kind: string): Promise<T[]> => {
    if (!cache.has(kind)) cache.set(kind, serverListEntities<T>(userId, kind));
    return cache.get(kind) as Promise<T[]>;
  };
  const sent = <T>(id: T) => {
    cache.clear();
    return id;
  };
  return {
    notes: () => serverListEntities<MeetingNote>(userId, MEETING_NOTE_KIND),
    put: async (note) => {
      await serverUpsertEntity<MeetingNote>(userId, MEETING_NOTE_KIND, note);
    },
    target: async (link) => {
      const id = link.targetId;
      if (link.route === "backlog-story") {
        const s = (await list<Story>(KIND_STORY)).find((x) => x.id === id);
        return !s ? "gone" : s.status === "done" ? "done" : "live";
      }
      if (link.route === "impediment") {
        const i = (await list<Impediment>(KIND_IMPEDIMENT)).find((x) => x.id === id);
        return !i ? "gone" : isResolved(i) ? "done" : "live";
      }
      if (link.route === "bug") {
        const b = (await list<BugReport>(BUG_REPORT_KIND)).find((x) => x.id === id);
        return !b ? "gone" : b.status === "closed" ? "done" : "live";
      }
      if (link.route === "retro-action") {
        for (const b of await list<RetroBoard>(KIND_RETRO)) {
          const card = b.cards.find((c) => c.id === id);
          if (card) return card.done ? "done" : "live";
        }
        return "gone";
      }
      if (link.route === "decision") return decisionState(decisions, id);
      return "gone";
    },
    send: async (route, src) => {
      if (route === "decision") {
        return sent((await createRecord(decisions, buildDecision(src, newRecordId()))).id);
      }
      if (route === "backlog-story") {
        // Stamped as the browser's store stamps a new story (createdAt).
        const story = stampStoryWrite(cleanStoryFields(buildBacklogStory(src)), undefined);
        await serverUpsertEntity<Story>(userId, KIND_STORY, story);
        return sent(story.id);
      }
      if (route === "impediment") {
        const impediment = buildImpediment(src);
        await serverUpsertEntity<Impediment>(userId, KIND_IMPEDIMENT, impediment);
        return sent(impediment.id);
      }
      if (route === "bug") {
        const bug = buildBugReport(src);
        await serverUpsertEntity<BugReport>(userId, BUG_REPORT_KIND, bug);
        return sent(bug.id);
      }
      // A retro action on the current retro, starting one (in the first
      // format, after the newest archive) as the page's send does.
      const all = await list<RetroBoard>(KIND_RETRO);
      const current = all.find((b) => b.id === RETRO_CURRENT_ID);
      const previous = newestArchivedRetro(all);
      const board =
        current ??
        blankRetroBoard(retroFormats[0], previous ? { previousRetroId: previous.id } : {});
      const card = buildRetroCard(src, board.format, true);
      await serverUpsertEntity<RetroBoard>(userId, KIND_RETRO, {
        ...board,
        cards: [...board.cards, card],
      });
      return sent(card.id);
    },
    roster: () => list<TeamMember>(KIND_MEMBER),
    sprints: () => list<Sprint>(KIND_SPRINT),
  };
}

/** The note by id as the page reads it. */
async function findNote(store: NotesStore, noteId: string): Promise<MeetingNote | null> {
  const raw = (await store.notes()).find((n) => n.id === noteId);
  return raw ? readMeetingNote(raw) : null;
}

const stamped = (note: MeetingNote, at = new Date().toISOString()): MeetingNote => ({
  ...note,
  updatedAt: at,
});

const NOT_FOUND = {
  reason: "not_found",
  message: "No meeting note with that id (see list_state).",
};

/** The running sprint's last day, for "end of sprint". */
async function sprintEndOf(store: NotesStore): Promise<string | undefined> {
  const active = (await store.sprints()).find((s) => s.status === "active" && !isExampleId(s.id));
  return active && isDay(active.endDate) ? active.endDate : undefined;
}

/* ── tool.notes_to_actions.list_state ────────────────────────────────── */

const ListParams = z.object({
  noteId: z.string().max(200).optional().describe("Only this note. Left out: every note."),
});

async function listState(store: NotesStore, params: z.infer<typeof ListParams>): Promise<Out> {
  const all = readMeetingNotes(await store.notes());
  const shown = params.noteId ? all.filter((n) => n.id === params.noteId) : all;
  return {
    notes: await Promise.all(
      shown.map(async (n) => ({
        id: n.id,
        meeting: n.meeting ?? null,
        date: n.date,
        textLength: n.text.length,
        forgotten: Boolean(n.forgottenAt),
        example: isExampleId(n.id),
        counts: noteCounts(n),
        done: isNoteDone(n),
        items: await Promise.all(
          n.items.map(async (i) => ({
            id: i.id,
            kind: i.kind,
            text: i.text,
            detail: i.detail ?? null,
            owner: i.owner ?? null,
            due: i.due ?? null,
            status: i.status,
            keptAt: i.keptAt,
            route: routeOf(i.kind),
            sentTo: await Promise.all(
              (i.sentTo ?? []).map(async (l) => ({
                route: l.route,
                targetId: l.targetId,
                at: l.at,
                target: await store.target(l),
              }))
            ),
          }))
        ),
      }))
    ),
  };
}

registry.register({
  id: "tool.notes_to_actions.list_state",
  toolId: "tool.notes_to_actions",
  name: "list_state",
  category: "read",
  description:
    "List the meeting notes as the page shows them, newest meeting first: each note's meeting, day, the length of its pasted text (never the text itself) and whether it was forgotten, the counts, and the items kept from it (never their quotes): kind (action | decision | impediment | story | bug | question), text, detail, owner, due, status (open | sent | dropped | answered), the route its kind takes (null for a question), and where it was sent with each target's state. Params: noteId?. Returns {notes: {id, meeting, date, textLength, forgotten, example, counts: {total, open, sent, dropped, answered}, done, items: {id, kind, text, detail, owner, due, status, keptAt, route, sentTo: {route, targetId, at, target: 'live' | 'done' | 'gone'}[]}[]}[]}.",
  paramsSchema: ListParams,
  handler: async (params) => listState(browserStore, params),
  mcpHandler: async (params, ctx) => listState(serverStore(ctx.userId), params),
});

/* ── tool.notes_to_actions.add_notes ─────────────────────────────────── */

const DayParam = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD")
  .refine(isDay, "Not a real date");

const AddParams = z.object({
  text: z
    .string()
    .max(TOOL_TEXT_MAX.paste)
    .refine((v) => v.trim() !== "", { message: "can't be blank" })
    .describe("The meeting's notes as pasted, at most 12,000 characters (split longer notes)."),
  meeting: z.string().max(TOOL_TEXT_MAX.short).optional().describe("The meeting's name."),
  date: DayParam.optional().describe("The meeting's day; default today."),
});

async function addNotes(store: NotesStore, params: z.infer<typeof AddParams>): Promise<Out> {
  const at = new Date().toISOString();
  const note = newMeetingNote(
    {
      text: params.text,
      ...(params.meeting ? { meeting: params.meeting } : {}),
      date: params.date ?? todayIso(),
    },
    `${MEETING_NOTE_ID_PREFIX}${nanoid(8)}`,
    at
  );
  await store.put(note);
  return { added: true, noteId: note.id, date: note.date, textLength: note.text.length };
}

registry.register({
  id: "tool.notes_to_actions.add_notes",
  toolId: "tool.notes_to_actions",
  name: "add_notes",
  category: "write",
  requiresConfirmation: false,
  description:
    "Paste a meeting's notes into Notes to Actions, as the page's paste box does. The text is kept in the user's own workspace until it is forgotten (forget_text). find_items returns lines of it, with any names in them, to whoever calls it. Params: text (at most 12,000 characters), meeting?, date? (YYYY-MM-DD, default today). Returns {added: true, noteId, date, textLength}. Then find_items, keep_items and send.",
  paramsSchema: AddParams,
  handler: async (params) => addNotes(browserStore, params),
  mcpHandler: async (params, ctx) => addNotes(serverStore(ctx.userId), params),
});

/* ── tool.notes_to_actions.find_items ────────────────────────────────── */

const NoteParams = z.object({ noteId: z.string().min(1).max(200) });

async function findItems(store: NotesStore, params: z.infer<typeof NoteParams>): Promise<Out> {
  const note = await findNote(store, params.noteId);
  if (!note) return { found: false, ...NOT_FOUND };
  if (!note.text.trim()) {
    return {
      found: false,
      reason: "forgotten",
      message: "This note's text was forgotten: only its kept items are left.",
    };
  }
  const items = extractByRules({
    notes: note.text,
    ...(note.meeting ? { meeting: note.meeting } : {}),
    date: note.date,
    sprintEnd: await sprintEndOf(store),
  });
  const roster = await store.roster();
  return {
    found: true,
    items: items.map((i) => ({
      ...i,
      // The roster's spelling, when they are on the team.
      ...(i.owner ? { owner: findRosterMember(roster, i.owner)?.name ?? i.owner } : {}),
      alreadyKept: alreadyKept(note, i),
    })),
  };
}

registry.register({
  id: "tool.notes_to_actions.find_items",
  toolId: "tool.notes_to_actions",
  name: "find_items",
  category: "read",
  description:
    "Find the actions, decisions, blockers (impediment), stories, bugs and open questions in a note's text by the page's keyword rules (what 'Find them without AI' does), each with the line it came from (quote), an owner named in the notes (the roster's spelling when on the team) and a due date the line names. Read only: nothing is kept. Confirm with the user, then keep_items. Params: noteId. Returns {found: true, items: {kind, text, owner?, due?, quote, alreadyKept}[]} or {found: false, reason: 'not_found' | 'forgotten', message}.",
  paramsSchema: NoteParams,
  handler: async (params) => findItems(browserStore, params),
  mcpHandler: async (params, ctx) => findItems(serverStore(ctx.userId), params),
});

/* ── tool.notes_to_actions.keep_items ────────────────────────────────── */

const KeepParams = z.object({
  noteId: z.string().min(1).max(200),
  items: z
    .array(
      z.object({
        kind: z.enum(MEETING_NOTE_ITEM_KINDS),
        text: z
          .string()
          .max(TOOL_TEXT_MAX.short)
          .refine((v) => v.trim() !== "", { message: "can't be blank" }),
        detail: z.string().max(TOOL_TEXT_MAX.text).optional(),
        owner: z.string().max(TOOL_TEXT_MAX.short).optional(),
        due: DayParam.optional(),
        quote: z.string().max(TOOL_TEXT_MAX.short).optional(),
      })
    )
    .min(1)
    .max(20),
});

async function keepItems(store: NotesStore, params: z.infer<typeof KeepParams>): Promise<Out> {
  const note = await findNote(store, params.noteId);
  if (!note) return { kept: 0, ...NOT_FOUND };
  const roster = await store.roster();
  const at = new Date().toISOString();
  const haystack = normalized(note.text);
  const kept: MeetingNoteItem[] = [];
  let skipped = 0;
  for (const raw of params.items) {
    const found: FoundItem = {
      kind: raw.kind,
      text: raw.text,
      ...(raw.detail ? { detail: raw.detail } : {}),
      ...(raw.owner
        ? { owner: findRosterMember(roster, raw.owner)?.name ?? raw.owner.trim() }
        : {}),
      // A due date before the meeting isn't one.
      ...(raw.due && raw.due >= note.date ? { due: raw.due } : {}),
      // A quote is kept only while it is a line of the notes.
      quote: raw.quote && haystack.includes(normalized(raw.quote)) ? raw.quote : "",
    };
    if (
      kept.length >= roomForItems(note) ||
      alreadyKept({ items: [...note.items, ...kept] }, found)
    ) {
      skipped++;
      continue;
    }
    kept.push(keptItem(found, `${NOTE_ITEM_ID_PREFIX}${nanoid(8)}`, at));
  }
  if (kept.length > 0) await store.put(stamped({ ...note, items: [...note.items, ...kept] }, at));
  return { kept: kept.length, skipped, itemIds: kept.map((i) => i.id) };
}

registry.register({
  id: "tool.notes_to_actions.keep_items",
  toolId: "tool.notes_to_actions",
  name: "keep_items",
  category: "write",
  requiresConfirmation: false,
  description:
    "Keep items on a note, as the page's Keep does: each open, stamped, with the roster's spelling of its owner; a due date before the meeting and a quote that isn't a line of the notes are left off. One already kept (same kind, and the same words or the same quoted line) and any past the note's 50 are skipped. Params: noteId, items: {kind, text, detail?, owner?, due?, quote?}[] (1–20). Returns {kept, skipped, itemIds}.",
  paramsSchema: KeepParams,
  handler: async (params) => keepItems(browserStore, params),
  mcpHandler: async (params, ctx) => keepItems(serverStore(ctx.userId), params),
});

/* ── tool.notes_to_actions.send ──────────────────────────────────────── */

const SendParams = z.object({
  noteId: z.string().min(1).max(200),
  itemId: z.string().min(1).max(64),
  route: z
    .enum(NOTE_ROUTES)
    .describe(
      "Where the item's kind goes: an action to retro-action, a decision to decision (proposed), an impediment to impediment, a story to backlog-story, a bug to bug."
    ),
});

async function send(store: NotesStore, params: z.infer<typeof SendParams>): Promise<Out> {
  const note = await findNote(store, params.noteId);
  if (!note) return { sent: false, ...NOT_FOUND };
  const item = note.items.find((i) => i.id === params.itemId);
  if (!item) return { sent: false, reason: "item_not_found" };
  if (isExampleId(note.id)) return { sent: false, reason: "example" };
  // As on the page: a dropped item isn't sent until it is opened again.
  if (item.status === "dropped") {
    return {
      sent: false,
      reason: "dropped",
      message:
        "It was dropped: open it again first (its status back to open, through workspace.meeting_note.update).",
    };
  }
  const route = routeOf(item.kind);
  if (!route) {
    return {
      sent: false,
      reason: "question",
      message: "A question is never sent: mark it answered, or drop it.",
    };
  }
  if (route !== params.route) {
    return {
      sent: false,
      reason: "wrong_route",
      message: `A ${KIND_ONE[item.kind].toLowerCase()} goes to ${route}. Change its kind first (workspace.meeting_note.update) to send it elsewhere.`,
    };
  }
  const existing = (item.sentTo ?? []).find((l) => l.route === route);
  if (existing && (await store.target(existing)) !== "gone") {
    return { sent: false, reason: "already_sent", targetId: existing.targetId };
  }
  const targetId = await store.send(route, itemSource(note, item));
  const at = new Date().toISOString();
  const link: HandoffLink = { route, targetId, at };
  const next = stamped(
    {
      ...note,
      items: note.items.map((i) =>
        i.id === item.id ? { ...i, status: "sent" as const, sentTo: withLink(i.sentTo, link) } : i
      ),
    },
    at
  );
  await store.put(next);
  return {
    sent: true,
    route,
    targetId,
    href: route === "decision" ? decisionHref(targetId) : ROUTES[route].targetHref(targetId),
    place: ROUTE_PLACE[route],
    noteDone: isNoteDone(next),
  };
}

registry.register({
  id: "tool.notes_to_actions.send",
  toolId: "tool.notes_to_actions",
  name: "send",
  category: "write",
  requiresConfirmation: false,
  description:
    "Send a kept item where its kind goes, as the page's Send does: an action to Retro Actions with its owner and due date (retro-action; a retro is started if none is open), a decision to the Decision Log as a proposed record whose recommendation is what the meeting agreed, numbered next in the log (decision), a blocker to Impediments (impediment), a story to the backlog (backlog-story), a bug to Bug Triage (bug). The quote is never sent. The new item links back (sourceRef notes-to-actions) and the item turns 'sent'. Questions and example notes are never sent, and a dropped item isn't sent until it is opened again. Params: noteId, itemId, route. Returns {sent: true, route, targetId, href, place, noteDone} or {sent: false, reason: 'not_found' | 'item_not_found' | 'example' | 'dropped' | 'question' | 'wrong_route' | 'already_sent', message?, targetId?}.",
  paramsSchema: SendParams,
  handler: async (params) => send(browserStore, params),
  mcpHandler: async (params, ctx) => send(serverStore(ctx.userId), params),
});

/* ── tool.notes_to_actions.drop / answer ─────────────────────────────── */

const ItemParams = z.object({
  noteId: z.string().min(1).max(200),
  itemId: z.string().min(1).max(64),
});

async function setStatus(
  store: NotesStore,
  params: z.infer<typeof ItemParams>,
  status: "dropped" | "answered"
): Promise<Out> {
  const note = await findNote(store, params.noteId);
  if (!note) return { updated: false, ...NOT_FOUND };
  const item = note.items.find((i) => i.id === params.itemId);
  if (!item) return { updated: false, reason: "item_not_found" };
  if (status === "answered" && item.kind !== "question") {
    return { updated: false, reason: "not_a_question", message: "Only a question is answered." };
  }
  if (item.status !== "open") {
    return {
      updated: false,
      reason: "not_open",
      message: `It is ${item.status} already.`,
    };
  }
  const next = stamped({
    ...note,
    items: note.items.map((i) => (i.id === item.id ? { ...i, status } : i)),
  });
  await store.put(next);
  return { updated: true, status, noteDone: isNoteDone(next) };
}

registry.register({
  id: "tool.notes_to_actions.drop",
  toolId: "tool.notes_to_actions",
  name: "drop",
  category: "write",
  requiresConfirmation: false,
  description:
    "Drop an open item kept from a note: it isn't real, or no longer needed. Params: noteId, itemId. Returns {updated: true, status: 'dropped', noteDone} or {updated: false, reason: 'not_found' | 'item_not_found' | 'not_open', message?}.",
  paramsSchema: ItemParams,
  handler: async (params) => setStatus(browserStore, params, "dropped"),
  mcpHandler: async (params, ctx) => setStatus(serverStore(ctx.userId), params, "dropped"),
});

registry.register({
  id: "tool.notes_to_actions.answer",
  toolId: "tool.notes_to_actions",
  name: "answer",
  category: "write",
  requiresConfirmation: false,
  description:
    "Mark an open question kept from a note answered: it needs no tool. Params: noteId, itemId. Returns {updated: true, status: 'answered', noteDone} or {updated: false, reason: 'not_found' | 'item_not_found' | 'not_a_question' | 'not_open', message?}.",
  paramsSchema: ItemParams,
  handler: async (params) => setStatus(browserStore, params, "answered"),
  mcpHandler: async (params, ctx) => setStatus(serverStore(ctx.userId), params, "answered"),
});

/* ── tool.notes_to_actions.forget_text ───────────────────────────────── */

async function forget(store: NotesStore, params: z.infer<typeof NoteParams>): Promise<Out> {
  const note = await findNote(store, params.noteId);
  if (!note) return { forgotten: false, ...NOT_FOUND };
  if (note.forgottenAt && !note.text) return { forgotten: false, reason: "already_forgotten" };
  await store.put(stamped(forgetText(note, new Date().toISOString())));
  return { forgotten: true, itemsKept: note.items.length };
}

registry.register({
  id: "tool.notes_to_actions.forget_text",
  toolId: "tool.notes_to_actions",
  name: "forget_text",
  category: "write",
  requiresConfirmation: false,
  description:
    "Forget a note's pasted text, as the page's 'Forget the notes' does: the text and every item's quote go; the items kept, their details and where they were sent stay. Params: noteId. Returns {forgotten: true, itemsKept} or {forgotten: false, reason: 'not_found' | 'already_forgotten'}.",
  paramsSchema: NoteParams,
  handler: async (params) => forget(browserStore, params),
  mcpHandler: async (params, ctx) => forget(serverStore(ctx.userId), params),
});
