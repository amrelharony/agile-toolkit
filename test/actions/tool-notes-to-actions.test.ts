/**
 * tool.notes_to_actions.* coverage, in the browser and over MCP.
 *
 *   1. registration — two reads and six writes, each with an MCP handler.
 *   2. list_state — never the pasted text or a quote, only its length.
 *   3. add_notes, find_items (the rules, read only), keep_items (roster
 *      spelling, grounding, room, repeats).
 *   4. send — each kind on its route with a link back, a decision proposed
 *      and numbered, a question never, the example never, once per route.
 *   5. drop, answer, forget_text.
 *   6. over MCP — the user's rows, decisions numbered after the log's.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BugReport,
  Decision,
  MeetingNote,
  MeetingNoteItem,
  RetroBoard,
} from "@/lib/stores/workspace-types";

const server = vi.hoisted(() => ({ rows: new Map<string, { id: string }>() }));

vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  const key = (kind: string, id: string) => `${kind}/${id}`;
  return {
    ...actual,
    serverListEntities: vi.fn(async (_u: string, kind: string) =>
      Array.from(server.rows.entries())
        .filter(([k]) => k.startsWith(`${kind}/`))
        .map(([, v]) => v)
    ),
    serverGetEntity: vi.fn(
      async (_u: string, kind: string, id: string) => server.rows.get(key(kind, id)) ?? null
    ),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, e: { id: string }) => {
      server.rows.set(key(kind, e.id), e);
    }),
    serverGetUserStateBlob: vi.fn(async () => null),
  };
});

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import "@/lib/actions/tools/notes-to-actions";

const ctx = (source: "agent" | "mcp" = "agent") => ({
  userId: "u",
  source,
  squadProfileIds: [] as string[],
});
const run = async <T>(id: string, params: Record<string, unknown> = {}, onServer = false) => {
  const a = registry.get(id)!;
  const handler = onServer ? (a.mcpHandler ?? a.handler) : a.handler;
  return (await handler(a.paramsSchema.parse(params), ctx(onServer ? "mcp" : "agent"))) as T;
};

const TEXT = [
  "- Ana to update the onboarding copy by Friday",
  "- Decided: we stop supporting the old export",
  "- Waiting on legal sign-off for the cookie banner",
  "- CSV export cuts off long names",
  "- Do we demo on staging or live?",
].join("\n");
const AT = "2026-11-20T10:00:00.000Z";
const item = (id: string, over: Partial<MeetingNoteItem> = {}): MeetingNoteItem => ({
  id,
  kind: "action",
  text: `Item ${id}`,
  status: "open",
  keptAt: AT,
  quote: "Ana to update the onboarding copy by Friday",
  ...over,
});
const note = (over: Partial<MeetingNote> = {}): MeetingNote => ({
  id: "mnote_a",
  meeting: "Sprint Review",
  date: "2026-11-20",
  text: TEXT,
  items: [
    item("a1", { owner: "Ana", due: "2026-11-27" }),
    item("d1", { kind: "decision", text: "Stop the old export", detail: "It costs a day a month" }),
    item("i1", { kind: "impediment", text: "Legal sign-off" }),
    item("s1", { kind: "story", text: "Refund screen" }),
    item("b1", { kind: "bug", text: "CSV cuts names", detail: "Names over 30 characters" }),
    item("q1", { kind: "question", text: "Staging or live?" }),
  ],
  createdAt: AT,
  updatedAt: AT,
  ...over,
});

const ws = () => useWorkspaceStore.getState();
const stored = (id = "mnote_a") => (ws().meetingNotes ?? []).find((n) => n.id === id);
const storedItem = (id: string) => stored()?.items.find((i) => i.id === id);

beforeEach(() => {
  server.rows.clear();
  useWorkspaceStore.setState({
    meetingNotes: [note()],
    stories: [],
    impediments: [],
    retroBoards: [],
    bugReports: [],
    decisions: [],
    daciDecisions: [],
    rapidDecisions: [],
    teamMembers: [{ id: "m1", name: "Ana Lima" }],
    sprints: [],
  });
});

describe("registration", () => {
  it("has the reads and the writes, each with an MCP handler", () => {
    for (const name of ["list_state", "find_items"]) {
      expect(registry.get(`tool.notes_to_actions.${name}`)?.category, name).toBe("read");
    }
    const writes = ["add_notes", "keep_items", "send", "drop", "answer", "forget_text"];
    for (const name of writes) {
      const a = registry.get(`tool.notes_to_actions.${name}`);
      expect(a?.category, name).toBe("write");
      expect(a?.requiresConfirmation, name).toBe(false);
      expect(a?.visitor, name).toBeUndefined();
    }
    for (const name of ["list_state", "find_items", ...writes]) {
      expect(registry.get(`tool.notes_to_actions.${name}`)?.mcpHandler, name).toBeTypeOf(
        "function"
      );
    }
  });
});

describe("list_state", () => {
  it("gives the text's length and never the text or a quote", async () => {
    const out = await run<{ notes: { textLength: number; items: unknown[] }[] }>(
      "tool.notes_to_actions.list_state"
    );
    expect(out.notes[0].textLength).toBe(TEXT.length);
    const json = JSON.stringify(out);
    expect(json).not.toContain("onboarding copy by Friday");
    expect(json).not.toContain("quote");
    expect(out.notes[0].items).toHaveLength(6);
  });
});

describe("add, find and keep", () => {
  it("adds notes for today with the meeting named", async () => {
    useWorkspaceStore.setState({ meetingNotes: [] });
    const out = await run<{ added: boolean; noteId: string; date: string }>(
      "tool.notes_to_actions.add_notes",
      { text: TEXT, meeting: "Sprint Review" }
    );
    expect(out.added).toBe(true);
    expect(out.noteId).toMatch(/^mnote_/);
    expect(stored(out.noteId)).toMatchObject({ meeting: "Sprint Review", text: TEXT, items: [] });
  });

  it("finds the rules' items with their quotes, the roster's spelling, and writes nothing", async () => {
    useWorkspaceStore.setState({ teamMembers: [{ id: "m1", name: "ana" }] });
    const before = JSON.stringify(ws().meetingNotes);
    const out = await run<{
      found: boolean;
      items: { kind: string; owner?: string; quote: string; alreadyKept: boolean }[];
    }>("tool.notes_to_actions.find_items", { noteId: "mnote_a" });
    expect(out.items.map((i) => i.kind)).toEqual([
      "action",
      "decision",
      "impediment",
      "bug",
      "question",
    ]);
    expect(out.items[0]).toMatchObject({
      owner: "ana",
      quote: "Ana to update the onboarding copy by Friday",
    });
    expect(JSON.stringify(ws().meetingNotes)).toBe(before);
  });

  it("refuses to find in forgotten notes", async () => {
    useWorkspaceStore.setState({ meetingNotes: [note({ text: "", forgottenAt: AT })] });
    expect(await run("tool.notes_to_actions.find_items", { noteId: "mnote_a" })).toMatchObject({
      found: false,
      reason: "forgotten",
    });
  });

  it("keeps items with the roster's spelling, a grounded quote and a real due date, once", async () => {
    useWorkspaceStore.setState({ meetingNotes: [note({ items: [] })] });
    const out = await run<{ kept: number; skipped: number }>("tool.notes_to_actions.keep_items", {
      noteId: "mnote_a",
      items: [
        {
          kind: "action",
          text: "Update the copy",
          owner: "ANA LIMA",
          due: "2026-11-01",
          quote: "ana to update the onboarding copy by friday",
        },
        { kind: "bug", text: "Made up", quote: "Not in the notes" },
        { kind: "action", text: "update the copy" },
      ],
    });
    expect(out).toMatchObject({ kept: 2, skipped: 1 });
    const [a, b] = stored()?.items ?? [];
    expect(a).toMatchObject({ owner: "Ana Lima", status: "open", quote: expect.any(String) });
    expect(a.due).toBeUndefined();
    expect(b.quote).toBeUndefined();
  });
});

describe("send", () => {
  it("sends an action to Retro Actions with its owner and due date, linked both ways", async () => {
    const out = await run<{ sent: boolean; targetId: string; noteDone: boolean }>(
      "tool.notes_to_actions.send",
      { noteId: "mnote_a", itemId: "a1", route: "retro-action" }
    );
    expect(out.sent).toBe(true);
    const card = ws().retroBoards[0].cards.find((c) => c.id === out.targetId);
    expect(card).toMatchObject({
      text: "Item a1",
      assignee: "Ana",
      dueDate: "2026-11-27",
      sourceRef: { tool: "notes-to-actions", id: "a1", doc: "mnote_a" },
    });
    expect(storedItem("a1")).toMatchObject({ status: "sent", sentTo: [{ route: "retro-action" }] });
    expect(
      await run("tool.notes_to_actions.send", {
        noteId: "mnote_a",
        itemId: "a1",
        route: "retro-action",
      })
    ).toMatchObject({ sent: false, reason: "already_sent" });
  });

  it("sends a decision as a proposed record with the meeting's words as its recommendation", async () => {
    useWorkspaceStore.setState({
      decisions: [
        {
          id: "old",
          title: "Old",
          decision: "x",
          status: "accepted",
          date: "2026-10-01",
          number: 4,
        } as Decision,
      ],
    });
    const out = await run<{ sent: boolean; targetId: string }>("tool.notes_to_actions.send", {
      noteId: "mnote_a",
      itemId: "d1",
      route: "decision",
    });
    const d = ws().decisions.find((x) => x.id === out.targetId);
    expect(d).toMatchObject({
      title: "Stop the old export",
      context: "It costs a day a month",
      status: "proposed",
      recommendation: "Stop the old export",
      number: 5,
      sourceRef: { tool: "notes-to-actions", id: "d1", doc: "mnote_a" },
    });
    expect(JSON.stringify(d)).not.toContain("onboarding");
  });

  it("sends a blocker, a story and a bug to their tools", async () => {
    await run("tool.notes_to_actions.send", {
      noteId: "mnote_a",
      itemId: "i1",
      route: "impediment",
    });
    await run("tool.notes_to_actions.send", {
      noteId: "mnote_a",
      itemId: "s1",
      route: "backlog-story",
    });
    await run("tool.notes_to_actions.send", { noteId: "mnote_a", itemId: "b1", route: "bug" });
    expect(ws().impediments[0]).toMatchObject({ title: "Legal sign-off" });
    expect(ws().stories[0]).toMatchObject({ title: "Refund screen", status: "backlog" });
    expect((ws().bugReports ?? [])[0]).toMatchObject({
      title: "CSV cuts names",
      actual: "Names over 30 characters",
      status: "new",
    });
  });

  it("refuses a question, the wrong route and the example's notes", async () => {
    expect(
      await run("tool.notes_to_actions.send", { noteId: "mnote_a", itemId: "q1", route: "bug" })
    ).toMatchObject({ sent: false, reason: "question" });
    expect(
      await run("tool.notes_to_actions.send", {
        noteId: "mnote_a",
        itemId: "b1",
        route: "impediment",
      })
    ).toMatchObject({ sent: false, reason: "wrong_route" });
    useWorkspaceStore.setState({ meetingNotes: [note({ id: "example-notes" })] });
    expect(
      await run("tool.notes_to_actions.send", {
        noteId: "example-notes",
        itemId: "b1",
        route: "bug",
      })
    ).toMatchObject({ sent: false, reason: "example" });
  });
});

describe("drop, answer and forget", () => {
  it("drops an open item, answers only a question, and says when the note is done", async () => {
    expect(
      await run("tool.notes_to_actions.answer", { noteId: "mnote_a", itemId: "a1" })
    ).toMatchObject({ updated: false, reason: "not_a_question" });
    expect(
      await run("tool.notes_to_actions.answer", { noteId: "mnote_a", itemId: "q1" })
    ).toMatchObject({ updated: true, status: "answered", noteDone: false });
    for (const id of ["a1", "d1", "i1", "s1"]) {
      await run("tool.notes_to_actions.drop", { noteId: "mnote_a", itemId: id });
    }
    expect(
      await run("tool.notes_to_actions.drop", { noteId: "mnote_a", itemId: "b1" })
    ).toMatchObject({ updated: true, noteDone: true });
    expect(
      await run("tool.notes_to_actions.drop", { noteId: "mnote_a", itemId: "b1" })
    ).toMatchObject({ updated: false, reason: "not_open" });
  });

  it("forgets the text and the quotes, keeping the items", async () => {
    expect(await run("tool.notes_to_actions.forget_text", { noteId: "mnote_a" })).toEqual({
      forgotten: true,
      itemsKept: 6,
    });
    expect(stored()?.text).toBe("");
    expect(stored()?.items.every((i) => i.quote === undefined)).toBe(true);
    expect(stored()?.items[1].detail).toBe("It costs a day a month");
  });
});

describe("over MCP", () => {
  it("writes the user's rows: a numbered decision, a bug and a retro action on a new retro", async () => {
    server.rows.set("workspace:meetingNote/mnote_a", note());
    server.rows.set("workspace:decision/old", {
      id: "old",
      title: "Old",
      decision: "x",
      status: "accepted",
      date: "2026-10-01",
      number: 9,
    } as Decision);
    const d = await run<{ targetId: string }>(
      "tool.notes_to_actions.send",
      { noteId: "mnote_a", itemId: "d1", route: "decision" },
      true
    );
    expect(server.rows.get(`workspace:decision/${d.targetId}`)).toMatchObject({
      status: "proposed",
      number: 10,
    });
    const b = await run<{ targetId: string }>(
      "tool.notes_to_actions.send",
      { noteId: "mnote_a", itemId: "b1", route: "bug" },
      true
    );
    expect((server.rows.get(`workspace:bugReport/${b.targetId}`) as BugReport).sourceRef).toEqual({
      tool: "notes-to-actions",
      id: "b1",
      doc: "mnote_a",
    });
    const a = await run<{ targetId: string }>(
      "tool.notes_to_actions.send",
      { noteId: "mnote_a", itemId: "a1", route: "retro-action" },
      true
    );
    const board = server.rows.get("workspace:retroBoard/retro:current") as RetroBoard;
    expect(board.cards.find((c) => c.id === a.targetId)).toMatchObject({ dueDate: "2026-11-27" });
    const row = server.rows.get("workspace:meetingNote/mnote_a") as MeetingNote;
    expect(row.items.filter((i) => i.status === "sent").map((i) => i.id)).toEqual([
      "a1",
      "d1",
      "b1",
    ]);
    const listed = await run<{
      notes: { items: { id: string; sentTo: { target: string }[] }[] }[];
    }>("tool.notes_to_actions.list_state", {}, true);
    const sentStates = listed.notes[0].items.flatMap((i) => i.sentTo.map((l) => l.target));
    expect(sentStates).toEqual(["live", "live", "live"]);
    expect(ws().decisions).toEqual([]);
  });
});
