/**
 * tool.backlog_health.* — Amr's Backlog Health verbs run the page's DEEP
 * scan, write Given/When/Then on a story beside its free text, and split a
 * big story, in the browser and on the MCP server.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetEntity: vi.fn(
      async (_u: string, kind: string, id: string) => rows.get(`${kind}/${id}`) ?? null
    ),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, e: { id: string }) => {
      rows.set(`${kind}/${e.id}`, e);
    }),
    serverListEntities: vi.fn(async (_u: string, kind: string) =>
      Array.from(rows.entries())
        .filter(([k]) => k.startsWith(`${kind}/`))
        .map(([, v]) => v)
    ),
  };
});

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Story } from "@/lib/stores/workspace-types";
import "@/lib/actions/tools/backlog-health";

const ctx = () => ({ userId: "u", source: "agent" as const, squadProfileIds: [] as string[] });
const run = async <T>(id: string, params: Record<string, unknown> = {}) => {
  const a = registry.get(id)!;
  return (await a.handler(a.paramsSchema.parse(params), ctx())) as T;
};
const mcp = async <T>(id: string, params: Record<string, unknown> = {}) => {
  const a = registry.get(id)!;
  return (await a.mcpHandler!(a.paramsSchema.parse(params), ctx())) as T;
};

const story = (over: Partial<Story> = {}): Story => ({
  id: "st1",
  title: "Pay with a saved card",
  status: "backlog",
  points: 3,
  acceptanceCriteria: "Charged once.",
  createdAt: "2026-11-01T00:00:00.000Z",
  backlogRank: 1,
  ...over,
});
const stories = () => useWorkspaceStore.getState().stories;
const SC = { given: "a saved card", when: "I pay", then: "I'm charged once" };

beforeEach(() => {
  rows.clear();
  useWorkspaceStore.setState({ stories: [], backlogItems: [] });
});

describe("registration", () => {
  it("has the scan and two writes with server handlers", () => {
    expect(registry.get("tool.backlog_health.list_state")?.category).toBe("read");
    for (const id of ["set_gwt", "split_story"]) {
      const a = registry.get(`tool.backlog_health.${id}`);
      expect(a?.category).toBe("write");
      expect(a?.mcpHandler).toBeTypeOf("function");
    }
  });
});

describe("list_state", () => {
  it("scans the backlog and lists the flagged stories", async () => {
    useWorkspaceStore.setState({
      stories: [
        story(),
        story({ id: "st2", title: "Login", acceptanceCriteria: undefined, backlogRank: 2 }),
        story({ id: "st3", sprintId: "s1", status: "todo", title: "Fix" }),
      ],
    });
    const r = await run<{
      total: number;
      verdict: string;
      checks: { id: string }[];
      flagged: { id: string; flags: { id: string }[] }[];
    }>("tool.backlog_health.list_state", { today: "2026-11-12" });
    expect(r.total).toBe(2);
    expect(r.checks.map((c) => c.id)).toEqual(["detailed", "estimated", "emergent", "prioritized"]);
    expect(r.flagged).toEqual([
      expect.objectContaining({
        id: "st2",
        flags: [
          expect.objectContaining({ id: "vague" }),
          expect.objectContaining({ id: "no-criteria" }),
        ],
      }),
    ]);
  });
});

describe("set_gwt", () => {
  it("replaces or adds scenarios, and leaves the free text as it is", async () => {
    useWorkspaceStore.setState({ stories: [story()] });
    expect(await run("tool.backlog_health.set_gwt", { storyId: "st1", scenarios: [SC] })).toEqual({
      updated: true,
      count: 1,
    });
    await run("tool.backlog_health.set_gwt", {
      storyId: "st1",
      scenarios: [{ ...SC, then: "I get a receipt" }],
      mode: "append",
    });
    const s = stories()[0];
    expect(s.gwt?.map((g) => g.then)).toEqual(["I'm charged once", "I get a receipt"]);
    expect(new Set(s.gwt?.map((g) => g.id)).size).toBe(2);
    expect(s.acceptanceCriteria).toBe("Charged once.");
    await run("tool.backlog_health.set_gwt", { storyId: "st1", scenarios: [] });
    expect("gwt" in stories()[0]).toBe(false);
  });

  it("refuses an unknown story and more than a story keeps", async () => {
    expect(await run("tool.backlog_health.set_gwt", { storyId: "zz", scenarios: [SC] })).toEqual({
      updated: false,
      reason: "No such story.",
    });
    useWorkspaceStore.setState({
      stories: [story({ gwt: Array.from({ length: 20 }, (_, i) => ({ id: `g${i}`, ...SC })) })],
    });
    const r = await run<{ updated: boolean }>("tool.backlog_health.set_gwt", {
      storyId: "st1",
      scenarios: [SC],
      mode: "append",
    });
    expect(r.updated).toBe(false);
  });

  it("writes on the server, stamped and cleaned like a story CRUD write", async () => {
    rows.set("workspace:story/st1", story());
    await mcp("tool.backlog_health.set_gwt", {
      storyId: "st1",
      scenarios: [{ given: "  a saved card ", when: "I pay", then: "I'm charged once" }],
    });
    const saved = rows.get("workspace:story/st1") as Story;
    expect(saved.gwt).toEqual([expect.objectContaining({ given: "a saved card" })]);
  });
});

describe("split_story", () => {
  it("adds smaller backlog stories that keep the original's priority and epic", async () => {
    useWorkspaceStore.setState({
      stories: [story({ points: 21, priorityScore: 7, epicId: "epic-1", tags: ["pay"] })],
    });
    const r = await run<{ split: boolean; ids: string[] }>("tool.backlog_health.split_story", {
      storyId: "st1",
      titles: ["Pay with a saved card: the main path", "Pay with a saved card: errors"],
    });
    expect(r.split).toBe(true);
    const made = stories().filter((s) => r.ids.includes(s.id));
    expect(made).toHaveLength(2);
    for (const s of made) {
      expect(s).toMatchObject({
        status: "backlog",
        priorityScore: 7,
        epicId: "epic-1",
        tags: ["pay"],
      });
      expect(s.points).toBeUndefined();
      expect(s.backlogRank).toBeUndefined();
    }
    // The original stays for the person to drop.
    expect(stories().find((s) => s.id === "st1")).toBeTruthy();
  });

  it("needs at least two titles and a real story", async () => {
    const a = registry.get("tool.backlog_health.split_story")!;
    expect(a.paramsSchema.safeParse({ storyId: "st1", titles: ["one"] }).success).toBe(false);
    expect(
      await run("tool.backlog_health.split_story", { storyId: "zz", titles: ["a", "b"] })
    ).toEqual({
      split: false,
      reason: "No such story.",
    });
  });
});
