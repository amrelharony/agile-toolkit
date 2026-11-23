/**
 * Test Sessions — tool-local actions.
 *
 * Category: Quality Engineering
 *
 * Agent surface: tool.test_sessions.*
 *   1. list_state       — the sessions, newest first: each charter, length,
 *                         status and clock, notes by kind with their minutes
 *                         in, the debrief, and where each bug note went.
 *   2. plan_session     — plan a session from a charter.
 *   3. start_session    — start a planned session (stamps only: no timer).
 *   4. add_note         — a note, bug, question or idea on a session.
 *   5. end_session      — end a running session, with its debrief.
 *   6. send_bugs        — log a session's bug notes in Bug Triage.
 *   7. suggest_charters — charters from the ten lenses (no AI). Read only.
 * Backing CRUD: workspace.test_session.* (defineCrudActions in
 * workspace/index.ts: create, list, update, delete, each write stamped).
 *
 * One store: workspace.testSessions (kind "workspace:testSession"). A bug
 * note sent to Bug Triage records the link on the note (`sentTo`), and the
 * bug links back to it (sourceRef test-sessions, doc = the session). Over
 * MCP the bugs are written to the user's rows on the server. Example
 * sessions (ids "example-…") never send. The page's docked timer is the
 * browser's own: these verbs never claim it, and the page counts a started
 * session from `startedAt`. History is the page's to log.
 */

import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import { serverListEntities, serverUpsertEntity } from "../server-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  BUG_REPORT_KIND,
  TEST_NOTE_KINDS,
  TEST_SESSION_COVERAGE,
  TEST_SESSION_KIND,
  TOOL_LIST_MAX,
  TOOL_TEXT_MAX,
  type BugReport,
  type HandoffLink,
  type TestSession,
} from "@/lib/stores/workspace-types";
import type { HandoffSource } from "@/lib/handoffs/types";
import { withLink } from "@/lib/handoffs/links";
import { bugHref, bugRoute, buildBugReport } from "@/lib/handoffs/targets/bug";
import { isExampleId } from "@/lib/utils/example-id";
import {
  DEFAULT_SESSION_MINUTES,
  SESSION_MINUTES_MAX,
  SESSION_MINUTES_MIN,
  bugLinkOf,
  canAddNote,
  charterSentence,
  chartersByLenses,
  minutesIn,
  minutesRan,
  newNote,
  newSession,
  noteCounts,
  noteToBug,
  readSessions,
  runningSession,
  sessionEndsAt,
  unsentBugNotes,
} from "@/lib/test-sessions/model";

const ws = () => useWorkspaceStore.getState();

type Out = Record<string, unknown>;

/* ── The store adapter ───────────────────────────────────────────────── */

interface SessionStore {
  sessions(): Promise<TestSession[]>;
  put(session: TestSession): Promise<void>;
  /** Bug Triage's bugs, to read where a note went. */
  bugs(): Promise<BugReport[]>;
  /** Log a bug in Bug Triage; returns its id. */
  addBug(src: HandoffSource): Promise<string>;
}

const browserStore: SessionStore = {
  sessions: async () => readSessions(ws().testSessions),
  put: async (session) => ws().upsertTestSession(session),
  bugs: async () => ws().bugReports ?? [],
  // The route itself, as the page's send calls it (no toast: an agent has no Undo).
  addBug: async (src) => bugRoute.send(src),
};

function serverStore(userId: string): SessionStore {
  return {
    sessions: async () =>
      readSessions(await serverListEntities<TestSession>(userId, TEST_SESSION_KIND)),
    put: async (session) => {
      await serverUpsertEntity<TestSession>(userId, TEST_SESSION_KIND, session);
    },
    bugs: () => serverListEntities<BugReport>(userId, BUG_REPORT_KIND),
    addBug: async (src) => {
      const bug = buildBugReport(src);
      await serverUpsertEntity<BugReport>(userId, BUG_REPORT_KIND, bug);
      return bug.id;
    },
  };
}

const nowIso = () => new Date().toISOString();
const stamped = (s: TestSession): TestSession => ({ ...s, updatedAt: nowIso() });

const SessionId = z.string().min(1).describe("The session's id (see list_state).");

/* ── tool.test_sessions.list_state ───────────────────────────────────── */

const ListParams = z.object({
  status: z.enum(["planned", "running", "done", "all"]).optional().describe("Default all."),
});

async function listState(store: SessionStore, p: z.infer<typeof ListParams>): Promise<Out> {
  const sessions = await store.sessions();
  const bugs = new Map((await store.bugs()).map((b) => [b.id, b]));
  const now = Date.now();
  const status = p.status ?? "all";
  const running = runningSession(sessions);
  return {
    running: running ? running.id : null,
    examples: sessions.filter((s) => isExampleId(s.id)).length,
    sessions: sessions
      .filter((s) => status === "all" || s.status === status)
      .map((s) => {
        const ends = sessionEndsAt(s);
        return {
          id: s.id,
          charter: s.charter,
          sentence: charterSentence(s.charter),
          tester: s.tester ?? null,
          storyId: s.storyId ?? null,
          area: s.area ?? null,
          minutes: s.minutes,
          status: s.status,
          startedAt: s.startedAt ?? null,
          endsAt: ends !== null ? new Date(ends).toISOString() : null,
          timeUp: s.status === "running" && ends !== null && now >= ends,
          endedAt: s.endedAt ?? null,
          minutesRan: minutesRan(s),
          coverage: s.coverage ?? null,
          split: s.split ?? null,
          debrief: s.debrief ?? null,
          example: isExampleId(s.id),
          noteCounts: noteCounts(s),
          unsentBugs: unsentBugNotes(s, (id) => bugs.has(id)).length,
          notes: s.notes.map((n) => {
            const link = bugLinkOf(n);
            const bug = link ? bugs.get(link.targetId) : undefined;
            return {
              id: n.id,
              at: n.at,
              kind: n.kind,
              text: n.text,
              minutesIn: minutesIn(n, s),
              bug: link
                ? {
                    targetId: link.targetId,
                    state: !bug ? "gone" : bug.status === "closed" ? "closed" : "open",
                  }
                : null,
            };
          }),
        };
      }),
  };
}

registry.register({
  id: "tool.test_sessions.list_state",
  toolId: "tool.test_sessions",
  name: "list_state",
  category: "read",
  description:
    "List Test Sessions as the page shows them, newest first. Params: status? (planned | running | done | all; default all). Returns {running (the running session's id) | null, examples, sessions: {id, charter: {target, using?, toLearn}, sentence (the charter as a sentence), tester, storyId, area, minutes, status, startedAt, endsAt, timeUp (running past its time), endedAt, minutesRan, coverage, split: {testing, bugs, setup} | null, debrief, example, noteCounts: {note, bug, question, idea}, unsentBugs (bug notes not in Bug Triage yet), notes: {id, at, kind, text, minutesIn, bug: {targetId, state: 'open' | 'closed' | 'gone'} | null}[]}[]}.",
  paramsSchema: ListParams,
  handler: async (p) => listState(browserStore, p),
  mcpHandler: async (p, ctx) => listState(serverStore(ctx.userId), p),
});

/* ── tool.test_sessions.plan_session ─────────────────────────────────── */

const Blank = (v: string) => v.replace(/\s+/g, " ").trim() !== "";

const PlanParams = z.object({
  target: z
    .string()
    .max(TOOL_TEXT_MAX.short)
    .refine(Blank, { message: "can't be blank" })
    .describe("What the session looks at."),
  using: z
    .string()
    .max(TOOL_TEXT_MAX.short)
    .optional()
    .describe("Using what: data, a device, a role."),
  toLearn: z
    .string()
    .max(TOOL_TEXT_MAX.text)
    .refine(Blank, { message: "can't be blank" })
    .describe("What you want to learn."),
  minutes: z
    .number()
    .int()
    .min(SESSION_MINUTES_MIN)
    .max(SESSION_MINUTES_MAX)
    .optional()
    .describe(`Its length in minutes; default ${DEFAULT_SESSION_MINUTES}.`),
  tester: z.string().max(TOOL_TEXT_MAX.short).optional().describe("Who tests."),
  storyId: z.string().min(1).max(TOOL_TEXT_MAX.short).optional().describe("The story it tests."),
  area: z.string().max(TOOL_TEXT_MAX.short).optional().describe("The product area."),
});

const line = (v: string | undefined) => (v ?? "").replace(/\s+/g, " ").trim();

async function plan(store: SessionStore, p: z.infer<typeof PlanParams>): Promise<Out> {
  const session = newSession(
    {
      charter: {
        target: line(p.target),
        ...(line(p.using) ? { using: line(p.using) } : {}),
        toLearn: p.toLearn.trim(),
      },
      minutes: p.minutes ?? DEFAULT_SESSION_MINUTES,
      ...(line(p.tester) ? { tester: line(p.tester) } : {}),
      ...(p.storyId ? { storyId: p.storyId } : {}),
      ...(line(p.area) ? { area: line(p.area) } : {}),
    },
    `tsess_${nanoid(8)}`,
    nowIso()
  );
  await store.put(session);
  return { planned: true, id: session.id, sentence: charterSentence(session.charter) };
}

registry.register({
  id: "tool.test_sessions.plan_session",
  toolId: "tool.test_sessions",
  name: "plan_session",
  category: "write",
  requiresConfirmation: false,
  description: `Plan an exploratory test session from a charter, as the page's plan form does: what to look at (target), using what, and what to learn, with a length of ${SESSION_MINUTES_MIN}–${SESSION_MINUTES_MAX} minutes (default ${DEFAULT_SESSION_MINUTES}), a tester, the story it tests and the area. Params: target, using?, toLearn, minutes?, tester?, storyId?, area?. Returns {planned: true, id, sentence}.`,
  paramsSchema: PlanParams,
  handler: async (p) => plan(browserStore, p),
  mcpHandler: async (p, ctx) => plan(serverStore(ctx.userId), p),
});

/* ── tool.test_sessions.start_session ────────────────────────────────── */

async function start(store: SessionStore, p: { id: string }): Promise<Out> {
  const sessions = await store.sessions();
  const session = sessions.find((s) => s.id === p.id);
  if (!session) return { started: false, reason: "not_found" };
  if (session.status !== "planned") return { started: false, reason: session.status };
  const other = runningSession(sessions);
  if (other) return { started: false, reason: "another_running", runningId: other.id };
  const next = stamped({ ...session, status: "running", startedAt: nowIso() });
  await store.put(next);
  const ends = sessionEndsAt(next);
  return {
    started: true,
    id: next.id,
    startedAt: next.startedAt,
    endsAt: ends !== null ? new Date(ends).toISOString() : null,
  };
}

registry.register({
  id: "tool.test_sessions.start_session",
  toolId: "tool.test_sessions",
  name: "start_session",
  category: "write",
  requiresConfirmation: false,
  description:
    "Start a planned test session: it is running from now. One session runs at a time. This stamps the start only: it claims no timer (the page's docked timer is the browser's own), and the page counts the session down from its start. Params: id. Returns {started: true, id, startedAt, endsAt} or {started: false, reason: 'not_found' | 'running' | 'done' | 'another_running', runningId?}.",
  paramsSchema: z.object({ id: SessionId }),
  handler: async (p) => start(browserStore, p),
  mcpHandler: async (p, ctx) => start(serverStore(ctx.userId), p),
});

/* ── tool.test_sessions.add_note ─────────────────────────────────────── */

const NoteParams = z.object({
  id: SessionId,
  kind: z.enum(TEST_NOTE_KINDS).describe("note, bug, question or idea."),
  text: z
    .string()
    .max(TOOL_TEXT_MAX.capture)
    .refine((v) => v.trim() !== "", { message: "can't be blank" })
    .describe("One line."),
});

async function addNote(store: SessionStore, p: z.infer<typeof NoteParams>): Promise<Out> {
  const session = (await store.sessions()).find((s) => s.id === p.id);
  if (!session) return { added: false, reason: "not_found" };
  if (session.status === "planned") return { added: false, reason: "not_started" };
  if (!canAddNote(session)) {
    return {
      added: false,
      reason: "full",
      message: `A session keeps at most ${TOOL_LIST_MAX.sessionNotes} notes.`,
    };
  }
  const note = newNote(p.kind, p.text, `tnote_${nanoid(8)}`, nowIso());
  await store.put(stamped({ ...session, notes: [...session.notes, note] }));
  return { added: true, id: session.id, noteId: note.id, minutesIn: minutesIn(note, session) };
}

registry.register({
  id: "tool.test_sessions.add_note",
  toolId: "tool.test_sessions",
  name: "add_note",
  category: "write",
  requiresConfirmation: false,
  description: `Add a note, bug, question or idea to a running or finished test session, stamped now with its minutes into the session. A planned session is refused ('not_started'); at most ${TOOL_LIST_MAX.sessionNotes} notes. Params: id, kind, text. Returns {added: true, id, noteId, minutesIn} or {added: false, reason: 'not_found' | 'not_started' | 'full'}.`,
  paramsSchema: NoteParams,
  handler: async (p) => addNote(browserStore, p),
  mcpHandler: async (p, ctx) => addNote(serverStore(ctx.userId), p),
});

/* ── tool.test_sessions.end_session ──────────────────────────────────── */

const Percent = z.number().int().min(0).max(100);

const EndParams = z.object({
  id: SessionId,
  coverage: z
    .enum(TEST_SESSION_COVERAGE)
    .optional()
    .describe("How much of the charter it covered."),
  split: z
    .object({ testing: Percent, bugs: Percent, setup: Percent })
    .refine((s) => s.testing + s.bugs + s.setup === 100, {
      message: "the time split adds up to 100",
    })
    .optional()
    .describe("Where the time went, in whole percents that add up to 100."),
  debrief: z.string().max(TOOL_TEXT_MAX.text).optional().describe("What was learned, what's next."),
});

async function end(store: SessionStore, p: z.infer<typeof EndParams>): Promise<Out> {
  const session = (await store.sessions()).find((s) => s.id === p.id);
  if (!session) return { ended: false, reason: "not_found" };
  if (session.status === "planned") return { ended: false, reason: "not_started" };
  const debrief = p.debrief?.trim();
  const next: TestSession = {
    ...session,
    status: "done",
    endedAt: session.endedAt ?? nowIso(),
    ...(p.coverage ? { coverage: p.coverage } : {}),
    ...(p.split ? { split: p.split } : {}),
    ...(debrief ? { debrief } : {}),
  };
  await store.put(stamped(next));
  return {
    ended: true,
    id: next.id,
    alreadyEnded: session.status === "done",
    minutesRan: minutesRan(next),
    unsentBugs: unsentBugNotes(next, () => false).filter((n) => !bugLinkOf(n)).length,
  };
}

registry.register({
  id: "tool.test_sessions.end_session",
  toolId: "tool.test_sessions",
  name: "end_session",
  category: "write",
  requiresConfirmation: false,
  description:
    "End a running test session now, with its debrief: how much of the charter it covered (all | most | some | little), where the time went (testing, bugs, setup in whole percents adding up to 100) and what was learned. On a finished session it updates the debrief. A planned session is refused ('not_started'). Params: id, coverage?, split?, debrief?. Returns {ended: true, id, alreadyEnded, minutesRan, unsentBugs (bug notes never sent: offer send_bugs)} or {ended: false, reason: 'not_found' | 'not_started'}.",
  paramsSchema: EndParams,
  handler: async (p) => end(browserStore, p),
  mcpHandler: async (p, ctx) => end(serverStore(ctx.userId), p),
});

/* ── tool.test_sessions.send_bugs ────────────────────────────────────── */

const SendParams = z.object({
  id: SessionId,
  noteIds: z
    .array(z.string().min(1))
    .max(TOOL_LIST_MAX.sessionNotes)
    .optional()
    .describe("Only these bug notes; default every bug note not sent yet."),
});

async function sendBugs(store: SessionStore, p: z.infer<typeof SendParams>): Promise<Out> {
  const session = (await store.sessions()).find((s) => s.id === p.id);
  if (!session) return { sent: 0, reason: "not_found" };
  if (isExampleId(session.id)) return { sent: 0, reason: "example" };
  const bugIds = new Set((await store.bugs()).map((b) => b.id));
  const todo = unsentBugNotes(session, (id) => bugIds.has(id)).filter(
    (n) => !p.noteIds || p.noteIds.includes(n.id)
  );
  if (todo.length === 0) return { sent: 0, reason: "none" };
  const made: { noteId: string; bugId: string; href: string }[] = [];
  let notes = session.notes;
  for (const n of todo) {
    const bugId = await store.addBug(noteToBug(n, session));
    const link: HandoffLink = { route: "bug", targetId: bugId, at: nowIso() };
    notes = notes.map((x) => (x.id === n.id ? { ...x, sentTo: withLink(x.sentTo, link) } : x));
    made.push({ noteId: n.id, bugId, href: bugHref(bugId) });
  }
  await store.put(stamped({ ...session, notes }));
  return { sent: made.length, bugs: made };
}

registry.register({
  id: "tool.test_sessions.send_bugs",
  toolId: "tool.test_sessions",
  name: "send_bugs",
  category: "write",
  requiresConfirmation: false,
  description:
    "Log a test session's bug notes in Bug Triage, as the page's 'Log all bugs' does: each becomes a new bug to triage, titled by the note's first line, with the whole note as what happened, the tester as who found it and the session's area; the bug links back to the session, and the note records the bug. Notes already there are skipped. Example sessions never send. Params: id, noteIds?. Returns {sent, bugs: {noteId, bugId, href}[]} or {sent: 0, reason: 'not_found' | 'example' | 'none'}.",
  paramsSchema: SendParams,
  handler: async (p) => sendBugs(browserStore, p),
  mcpHandler: async (p, ctx) => sendBugs(serverStore(ctx.userId), p),
});

/* ── tool.test_sessions.suggest_charters ─────────────────────────────── */

const SuggestParams = z.object({
  target: z
    .string()
    .max(TOOL_TEXT_MAX.short)
    .refine(Blank, { message: "can't be blank" })
    .describe("What to explore: a story's title or a part of the product."),
  details: z
    .string()
    .max(2000)
    .optional()
    .describe("The story's notes, criteria or Given/When/Then."),
  count: z.number().int().min(1).max(6).optional().describe("How many; default 3."),
});

async function suggestCharters(
  store: SessionStore,
  p: z.infer<typeof SuggestParams>
): Promise<Out> {
  const past = (await store.sessions())
    .filter((s) => !isExampleId(s.id))
    .slice(0, 20)
    .map((s) => charterSentence(s.charter));
  return {
    charters: chartersByLenses({
      target: p.target,
      details: p.details ?? "",
      past,
      count: p.count ?? 3,
    }),
  };
}

registry.register({
  id: "tool.test_sessions.suggest_charters",
  toolId: "tool.test_sessions",
  name: "suggest_charters",
  category: "read",
  description:
    "Suggest charters for exploratory test sessions, as Suggest charters without AI does: one per Given/When/Then row in the details, then ten lenses (limits, odd input, interruptions, roles, lots of data, devices, keyboard and screen reader, slow network, dates and time zones, repeats) ranked by the words in the target and details, skipping lenses past sessions used. Only suggests: confirm with the user, then use plan_session. Params: target, details?, count? (1–6). Returns {charters: {target, using, toLearn, minutes, why}[]}.",
  paramsSchema: SuggestParams,
  handler: async (p) => suggestCharters(browserStore, p),
  mcpHandler: async (p, ctx) => suggestCharters(serverStore(ctx.userId), p),
});
