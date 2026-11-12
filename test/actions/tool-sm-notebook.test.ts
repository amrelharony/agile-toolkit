/**
 * tool.sm_notebook.* on both transports (the browser store and, over MCP,
 * the user's own rows): list_state, search as the page searches, the week
 * read without AI with only real tools, add_note as the page saves one, and
 * tag_note. None of them reaches a room, so visitors keep them.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  const prefix = (kind: string) => `${kind}/`;
  return {
    ...actual,
    serverListEntities: vi.fn(async (_u: string, kind: string) =>
      Array.from(rows.entries())
        .filter(([k]) => k.startsWith(prefix(kind)))
        .map(([, v]) => v)
    ),
    serverGetEntity: vi.fn(async (_u: string, kind: string, id: string) => {
      return rows.get(`${kind}/${id}`) ?? null;
    }),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, entity: { id: string }) => {
      rows.set(`${kind}/${entity.id}`, entity);
    }),
  };
});

import { registry } from "@/lib/actions/registry";
import { isVisitorAction } from "@/lib/agent/visitor-tools";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { NOTEBOOK_ENTRY_KIND, type NotebookEntry } from "@/lib/stores/workspace-types";
import { getToolById } from "@/lib/constants/tools";

import "@/lib/actions/tools/sm-notebook";

type Path = "handler" | "mcpHandler";
const TRANSPORTS: Path[] = ["handler", "mcpHandler"];
const ctx = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
const VERBS = ["list_state", "search", "weekly_summary", "add_note", "tag_note"];

const run = <T = Record<string, unknown>>(
  path: Path,
  verb: string,
  params: Record<string, unknown> = {}
) => {
  const action = registry.get(`tool.sm_notebook.${verb}`)!;
  return action[path]!(action.paramsSchema.parse(params), ctx) as Promise<T>;
};

const AT = "2026-11-12T09:00:00.000Z";
const note = (id: string, date: string, over: Partial<NotebookEntry> = {}): NotebookEntry => ({
  id,
  date,
  body: `Note ${id}`,
  tags: [],
  createdAt: AT,
  updatedAt: AT,
  ...over,
});

function seed(path: Path, list: NotebookEntry[]) {
  if (path === "handler") useWorkspaceStore.setState({ notebookEntries: list });
  else for (const e of list) rows.set(`${NOTEBOOK_ENTRY_KIND}/${e.id}`, e);
}

const stored = (path: Path): NotebookEntry[] =>
  path === "handler"
    ? (useWorkspaceStore.getState().notebookEntries ?? [])
    : Array.from(rows.entries())
        .filter(([k]) => k.startsWith(`${NOTEBOOK_ENTRY_KIND}/`))
        .map(([, v]) => v as NotebookEntry);

// Thursday 12 Nov 2026: its week runs from Monday 9 Nov.
const TODAY = new Date("2026-11-12T10:00:00");

const WEEK: NotebookEntry[] = [
  note("a", "2026-11-09", {
    title: "Sandbox",
    body: "Blocked on the sandbox again.",
    tags: ["blockers"],
    event: "daily-scrum",
    linkedTool: "impediments",
  }),
  note("b", "2026-11-10", { body: "Still stuck on access.", event: "daily-scrum" }),
  note("c", "2026-11-11", {
    body: "Estimates were 3 and 13.",
    tags: ["estimation"],
    event: "refinement",
  }),
  note("d", "2026-11-12", {
    body: "Waiting on the other team.",
    event: "daily-scrum",
    linkedTool: "made-up",
  }),
  note("s", "2026-11-12", {
    title: "Week of 9 Nov 2026: summary",
    body: "Kept.",
    tags: ["weekly-summary"],
  }),
  note("old", "2026-11-02", { body: "Last week's note.", tags: ["kudos"] }),
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TODAY);
  rows.clear();
  useWorkspaceStore.setState({ notebookEntries: [] });
});
afterEach(() => vi.useRealTimers());

describe("registration", () => {
  it("reads three ways and writes two, every verb on both transports and open to visitors", () => {
    for (const verb of VERBS) {
      const a = registry.get(`tool.sm_notebook.${verb}`);
      expect(a, verb).toBeDefined();
      expect(a!.mcpHandler, verb).toBeTypeOf("function");
      expect(isVisitorAction(a!), verb).toBe(true);
    }
    for (const verb of ["list_state", "search", "weekly_summary"]) {
      expect(registry.get(`tool.sm_notebook.${verb}`)!.category).toBe("read");
    }
    for (const verb of ["add_note", "tag_note"]) {
      const a = registry.get(`tool.sm_notebook.${verb}`)!;
      expect(a.category).toBe("write");
      expect(a.requiresConfirmation).toBe(false);
    }
  });
});

describe.each(TRANSPORTS)("over %s", (path) => {
  it("list_state counts the notes, this week, the tags and events, newest first", async () => {
    seed(path, WEEK);
    const r = await run<{
      total: number;
      thisWeek: { weekStart: string; notes: number; summaries: number };
      tags: { tag: string; count: number }[];
      events: { event: string; count: number }[];
      recent: { id: string; linkedTool?: { id: string } }[];
    }>(path, "list_state");
    expect(r.total).toBe(6);
    expect(r.thisWeek).toEqual({
      weekStart: "2026-11-09",
      weekEnd: "2026-11-15",
      notes: 4,
      summaries: 1,
    });
    expect(r.tags[0]).toEqual({ tag: "blockers", count: 1 });
    expect(r.events[0]).toEqual({ event: "daily-scrum", label: "Daily Scrum", count: 3 });
    // Newest day first; one day's notes by the latest written, then by id.
    expect(r.recent.map((n) => n.id)).toEqual(["s", "d", "c", "b", "a", "old"]);
    // A linked tool only by a name the registry knows.
    expect(r.recent.find((n) => n.id === "a")!.linkedTool).toEqual({
      id: "impediments",
      name: "Impediment Tracker",
      href: "/impediments",
    });
    expect(r.recent.find((n) => n.id === "d")!.linkedTool).toBeUndefined();
  });

  it("search finds by words, tags, event and days, newest first, with a cut text", async () => {
    seed(path, [...WEEK, note("long", "2026-11-05", { body: "blocked ".repeat(200) })]);
    const words = await run<{ matches: number; notes: { id: string; bodyCut: boolean }[] }>(
      path,
      "search",
      { query: "Impediment tracker" }
    );
    expect(words.notes.map((n) => n.id)).toEqual(["a"]);
    const byEvent = await run<{ matches: number }>(path, "search", { event: "daily-scrum" });
    expect(byEvent.matches).toBe(3);
    const byTag = await run<{ notes: { id: string }[] }>(path, "search", { tags: ["Estimation"] });
    expect(byTag.notes.map((n) => n.id)).toEqual(["c"]);
    const days = await run<{ notes: { id: string }[] }>(path, "search", {
      from: "2026-11-02",
      to: "2026-11-05",
    });
    expect(days.notes.map((n) => n.id)).toEqual(["long", "old"]);
    const long = await run<{ notes: { body: string; bodyCut: boolean }[] }>(path, "search", {
      query: "blocked",
      to: "2026-11-05",
    });
    expect(long.notes[0].bodyCut).toBe(true);
    expect(long.notes[0].body.length).toBe(1000);
    const one = await run<{ matches: number; notes: unknown[] }>(path, "search", { limit: 1 });
    expect(one.matches).toBe(7);
    expect(one.notes).toHaveLength(1);
  });

  it("weekly_summary reads the week without AI, summaries left out, only real tools", async () => {
    seed(path, WEEK);
    const r = await run<{
      weekStart: string;
      notes: number;
      summary: string;
      patterns: string[];
      suggestedTools: { id: string; href: string }[];
      keptSummaries: { id: string }[];
      source: string;
    }>(path, "weekly_summary", { weekOf: "2026-11-11" });
    expect(r.weekStart).toBe("2026-11-09");
    expect(r.notes).toBe(4);
    expect(r.summary).toMatch(
      /^4 notes in the week of 9 Nov 2026, 3 of them from the Daily Scrum\./
    );
    expect(r.patterns[0]).toBe("“blockers” came up in 3 notes, at the Daily Scrum.");
    expect(r.suggestedTools.length).toBeGreaterThan(0);
    for (const t of r.suggestedTools) {
      expect(getToolById(t.id), t.id).toBeDefined();
      expect(t.href).toBe(`/${t.id}`);
    }
    expect(r.keptSummaries.map((s) => s.id)).toEqual(["s"]);
    expect(r.source).toBe("fallback");

    const empty = await run<{ notes: number; summary: string; suggestedTools: unknown[] }>(
      path,
      "weekly_summary",
      { weekOf: "2026-10-01" }
    );
    expect(empty.notes).toBe(0);
    expect(empty.summary).toBe("No notes in the week of 28 Sep 2026 yet.");
    expect(empty.suggestedTools).toEqual([]);
  });

  it("add_note saves a note as the page does: tags tidied, an unknown tool dropped, times stamped", async () => {
    const r = await run<{ added: boolean; id: string; tags: string[]; droppedLinkedTool?: string }>(
      path,
      "add_note",
      {
        body: "  Two quiet voices.  ",
        title: " Quiet ",
        tags: ["Participation", "participation", " UX "],
        event: "daily-scrum",
        linkedTool: "not-a-tool",
      }
    );
    expect(r).toMatchObject({
      added: true,
      tags: ["participation", "ux"],
      droppedLinkedTool: "not-a-tool",
    });
    expect(r.id).toMatch(/^note_/);
    const [saved] = stored(path);
    expect(saved).toMatchObject({
      id: r.id,
      date: "2026-11-12",
      title: "Quiet",
      body: "Two quiet voices.",
      event: "daily-scrum",
      createdAt: TODAY.toISOString(),
      updatedAt: TODAY.toISOString(),
    });
    expect(saved).not.toHaveProperty("linkedTool");

    const linked = await run<{ added: boolean; id: string }>(path, "add_note", {
      body: "Blocked.",
      linkedTool: "Impediments",
      date: "2026-11-01",
    });
    expect(stored(path).find((e) => e.id === linked.id)).toMatchObject({
      linkedTool: "impediments",
      date: "2026-11-01",
    });
  });

  it("add_note refuses a blank note and a day that hasn't happened", async () => {
    expect(await run(path, "add_note", { body: "   " })).toEqual({ added: false, reason: "blank" });
    expect(await run(path, "add_note", { body: "x", date: "2026-02-30" })).toEqual({
      added: false,
      reason: "not_a_day",
    });
    // Over MCP the server's day may be behind the user's: tomorrow is allowed there.
    const tomorrow = await run<{ added: boolean; reason?: string }>(path, "add_note", {
      body: "x",
      date: "2026-11-13",
    });
    expect(tomorrow.added).toBe(path === "mcpHandler");
    expect(await run(path, "add_note", { body: "x", date: "2026-11-20" })).toEqual({
      added: false,
      reason: "future_day",
    });
  });

  it("tag_note adds tags once and keeps the ones the note has", async () => {
    seed(path, [note("n", "2026-11-10", { tags: ["blockers"], createdAt: "" })]);
    const r = await run(path, "tag_note", { id: "n", tags: ["Blockers", "Dependencies"] });
    expect(r).toEqual({
      tagged: true,
      tags: ["blockers", "dependencies"],
      added: ["dependencies"],
    });
    const saved = stored(path).find((e) => e.id === "n")!;
    expect(saved.tags).toEqual(["blockers", "dependencies"]);
    expect(saved.updatedAt).toBe(TODAY.toISOString());
    expect(saved.createdAt).toBe(TODAY.toISOString());
    expect(await run(path, "tag_note", { id: "ghost", tags: ["x"] })).toEqual({
      tagged: false,
      reason: "not_found",
    });
    const full = Array.from({ length: 20 }, (_, i) => `t${i}`);
    expect(await run(path, "tag_note", { id: "n", tags: full })).toEqual({
      tagged: false,
      reason: "too_many_tags",
      max: 20,
    });
  });
});
