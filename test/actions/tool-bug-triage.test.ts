/**
 * tool.bug_triage.* coverage, in the browser and over MCP.
 *
 *   1. registration — reads and writes, each with an MCP handler, none a room verb.
 *   2. list_state — oldest first, filters, the grid's cells with advice,
 *      link states read from the stories and interrupts, counts without the example.
 *   3. log_bug, triage (refuses a closed bug), close (a duplicate needs a
 *      real other bug), reopen (back where it was).
 *   4. send — fix now as an interrupt in the running sprint (refused with no
 *      sprint), plan it as a backlog story tagged bug; a second send is
 *      refused; examples never go; over MCP the targets are the user's rows.
 *   5. suggest — the rules, examples left out.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BugReport, InterruptItem, Sprint, Story } from "@/lib/stores/workspace-types";

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
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, e: { id: string }) => {
      server.rows.set(key(kind, e.id), e);
    }),
  };
});

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import "@/lib/actions/tools/bug-triage";

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

const bug = (over: Partial<BugReport> = {}): BugReport => ({
  id: "bug_a",
  title: "Payments fail at checkout",
  status: "new",
  createdAt: "2026-11-12T09:00:00.000Z",
  updatedAt: "2026-11-12T09:00:00.000Z",
  ...over,
});
const placed = (over: Partial<BugReport> = {}) =>
  bug({
    status: "triaged",
    severity: "critical",
    priority: "now",
    triagedAt: "2026-11-12T10:00:00Z",
    ...over,
  });

const sprint = (over: Partial<Sprint> = {}): Sprint =>
  ({
    id: "sprint_1",
    name: "Sprint 1",
    startDate: "2026-11-10",
    endDate: "2026-11-21",
    status: "active",
    ...over,
  }) as Sprint;

const ws = () => useWorkspaceStore.getState();
const stored = (id: string) => (ws().bugReports ?? []).find((b) => b.id === id);

beforeEach(() => {
  server.rows.clear();
  useWorkspaceStore.setState({ bugReports: [], stories: [], interruptItems: [], sprints: [] });
});

describe("registration", () => {
  it("has the reads and the writes, each with an MCP handler", () => {
    for (const name of ["list_state", "suggest"]) {
      expect(registry.get(`tool.bug_triage.${name}`)?.category, name).toBe("read");
    }
    for (const name of ["log_bug", "triage", "send", "close", "reopen"]) {
      const a = registry.get(`tool.bug_triage.${name}`);
      expect(a?.category, name).toBe("write");
      expect(a?.requiresConfirmation, name).toBe(false);
      expect(a?.visitor, name).toBeUndefined();
    }
    for (const name of ["list_state", "suggest", "log_bug", "triage", "send", "close", "reopen"]) {
      expect(registry.get(`tool.bug_triage.${name}`)?.mcpHandler, name).toBeTypeOf("function");
    }
  });
});

describe("list_state", () => {
  it("lists oldest first with filters, cells, link states and counts without the example", async () => {
    ws().upsertStory({ id: "s1", title: "Fix", status: "done" });
    useWorkspaceStore.setState({
      bugReports: [
        placed({
          id: "b",
          createdAt: "2026-11-13T09:00:00Z",
          severity: "major",
          priority: "next",
          sentTo: [
            { route: "backlog-story", targetId: "s1", at: "2026-11-13T10:00:00Z" },
            { route: "interrupt", targetId: "gone", at: "2026-11-13T10:00:00Z" },
          ],
        }),
        bug({ id: "a" }),
        bug({ id: "example-1", createdAt: "2026-11-11T09:00:00Z" }),
      ],
    });
    const all = await run<{
      counts: Record<string, number>;
      examples: number;
      cells: { severity: string; priority: string; open: number; check: boolean; advice: string }[];
      bugs: { id: string; place: string; workDone: boolean; sentTo: { target: string }[] }[];
    }>("tool.bug_triage.list_state");
    expect(all.bugs.map((b) => b.id)).toEqual(["example-1", "a", "b"]);
    expect(all.counts).toMatchObject({ open: 2, toTriage: 1, onGrid: 1, closed: 0 });
    expect(all.examples).toBe(1);
    expect(all.cells).toHaveLength(16);
    expect(all.cells.find((c) => c.severity === "major" && c.priority === "next")?.open).toBe(1);
    expect(all.cells.find((c) => c.severity === "cosmetic" && c.priority === "now")?.check).toBe(
      true
    );
    const b = all.bugs.find((x) => x.id === "b")!;
    expect(b.place).toBe("grid");
    expect(b.workDone).toBe(true);
    expect(b.sentTo.map((l) => l.target)).toEqual(["done", "gone"]);

    const queue = await run<{ bugs: { id: string }[] }>("tool.bug_triage.list_state", {
      status: "new",
    });
    expect(queue.bugs.map((x) => x.id)).toEqual(["example-1", "a"]);
    const major = await run<{ bugs: { id: string }[] }>("tool.bug_triage.list_state", {
      severity: "major",
    });
    expect(major.bugs.map((x) => x.id)).toEqual(["b"]);
  });
});

describe("log, triage, close and reopen", () => {
  it("logs a new bug on one line", async () => {
    const out = await run<{ logged: boolean; id: string }>("tool.bug_triage.log_bug", {
      title: "  The receipt\nshows pounds ",
      area: " Receipts ",
      reportedBy: "",
    });
    expect(out.logged).toBe(true);
    expect(out.id).toMatch(/^bug_/);
    expect(stored(out.id)).toMatchObject({
      title: "The receipt shows pounds",
      area: "Receipts",
      status: "new",
    });
    expect(stored(out.id)?.reportedBy).toBeUndefined();
    expect(() =>
      registry.get("tool.bug_triage.log_bug")!.paramsSchema.parse({ title: "  " })
    ).toThrow();
  });

  it("places a bug and says where its cell sends it", async () => {
    useWorkspaceStore.setState({ bugReports: [bug()] });
    const out = await run<{ triaged: boolean; route: string | null; check: boolean }>(
      "tool.bug_triage.triage",
      { id: "bug_a", severity: "cosmetic", priority: "now", checks: { reach: "one" } }
    );
    expect(out).toMatchObject({ triaged: true, route: "interrupt", check: true });
    expect(stored("bug_a")).toMatchObject({
      status: "triaged",
      severity: "cosmetic",
      priority: "now",
      checks: { reach: "one" },
    });
    expect(stored("bug_a")?.triagedAt).toBeDefined();
  });

  it("refuses to triage a closed bug, and closes a duplicate only with a real other bug", async () => {
    useWorkspaceStore.setState({
      bugReports: [bug(), bug({ id: "bug_b" }), bug({ id: "bug_c", status: "closed" })],
    });
    expect(
      await run("tool.bug_triage.triage", { id: "bug_c", severity: "minor", priority: "later" })
    ).toMatchObject({ triaged: false, reason: "closed" });
    expect(await run("tool.bug_triage.close", { id: "bug_a", reason: "duplicate" })).toMatchObject({
      closed: false,
      reason: "duplicate_of",
    });
    expect(
      await run("tool.bug_triage.close", { id: "bug_a", reason: "duplicate", duplicateOf: "bug_a" })
    ).toMatchObject({ closed: false, reason: "duplicate_of" });
    expect(
      await run("tool.bug_triage.close", { id: "bug_a", reason: "duplicate", duplicateOf: "bug_b" })
    ).toEqual({ closed: true, id: "bug_a", reason: "duplicate" });
    expect(stored("bug_a")).toMatchObject({ status: "closed", duplicateOf: "bug_b" });
    expect(await run("tool.bug_triage.close", { id: "bug_a", reason: "fixed" })).toMatchObject({
      closed: false,
      reason: "already_closed",
    });
  });

  it("reopens a bug where it was: on the grid when it was placed", async () => {
    useWorkspaceStore.setState({
      bugReports: [
        placed({ status: "closed", closeReason: "fixed", closedAt: "2026-11-14T10:00:00Z" }),
        bug({ id: "bug_b", status: "closed", closeReason: "not-a-bug" }),
      ],
    });
    expect(await run("tool.bug_triage.reopen", { id: "bug_a" })).toMatchObject({
      reopened: true,
      status: "triaged",
    });
    expect(stored("bug_a")?.closeReason).toBeUndefined();
    expect(await run("tool.bug_triage.reopen", { id: "bug_b" })).toMatchObject({ status: "new" });
    expect(await run("tool.bug_triage.reopen", { id: "bug_b" })).toMatchObject({
      reopened: false,
      reason: "open",
    });
  });
});

describe("send", () => {
  it("logs a fix-now bug as an interrupt in the running sprint, linked both ways", async () => {
    useWorkspaceStore.setState({ bugReports: [placed()], sprints: [sprint()] });
    const out = await run<{ sent: boolean; targetId: string; href: string }>(
      "tool.bug_triage.send",
      { id: "bug_a", route: "interrupt" }
    );
    expect(out.sent).toBe(true);
    const item = (ws().interruptItems ?? []).find((i) => i.id === out.targetId);
    expect(item).toMatchObject({
      sprintId: "sprint_1",
      kind: "bug",
      emergency: true,
      sourceRef: { tool: "bug-triage", id: "bug_a" },
    });
    expect(out.href).toBe("/interrupt-buffer?sprint=sprint_1");
    expect(stored("bug_a")?.sentTo).toEqual([
      expect.objectContaining({ route: "interrupt", targetId: out.targetId }),
    ]);
    expect(await run("tool.bug_triage.send", { id: "bug_a", route: "interrupt" })).toMatchObject({
      sent: false,
      reason: "already_sent",
    });
  });

  it("refuses an interrupt with no sprint running, and plans it on the backlog instead", async () => {
    useWorkspaceStore.setState({
      bugReports: [placed({ steps: "Pay", area: "Checkout" })],
      sprints: [sprint({ id: "example-sprint" })],
    });
    expect(await run("tool.bug_triage.send", { id: "bug_a", route: "interrupt" })).toMatchObject({
      sent: false,
      reason: "no_sprint",
    });
    const out = await run<{ sent: boolean; targetId: string }>("tool.bug_triage.send", {
      id: "bug_a",
      route: "backlog-story",
    });
    expect(out.sent).toBe(true);
    const story = ws().stories.find((s) => s.id === out.targetId);
    expect(story).toMatchObject({
      title: "Payments fail at checkout",
      status: "backlog",
      tags: ["bug"],
      sourceRef: { tool: "bug-triage", id: "bug_a" },
    });
    expect(story?.notes).toContain("Steps: Pay");
  });

  it("never sends an example or a closed bug", async () => {
    useWorkspaceStore.setState({
      bugReports: [placed({ id: "example-1" }), placed({ id: "bug_c", status: "closed" })],
      sprints: [sprint()],
    });
    expect(
      await run("tool.bug_triage.send", { id: "example-1", route: "interrupt" })
    ).toMatchObject({ sent: false, reason: "example" });
    expect(
      await run("tool.bug_triage.send", { id: "bug_c", route: "backlog-story" })
    ).toMatchObject({ sent: false, reason: "closed" });
    expect(ws().interruptItems ?? []).toEqual([]);
    expect(ws().stories).toEqual([]);
  });

  it("over MCP writes the user's rows: an interrupt in their active sprint, a story", async () => {
    server.rows.set("workspace:bugReport/bug_a", placed());
    server.rows.set(
      "workspace:bugReport/bug_b",
      placed({ id: "bug_b", priority: "next", severity: "major" })
    );
    server.rows.set("workspace:sprint/sprint_1", sprint());
    const out = await run<{ sent: boolean; targetId: string; href: string }>(
      "tool.bug_triage.send",
      { id: "bug_a", route: "interrupt" },
      true
    );
    expect(out.sent).toBe(true);
    expect(out.href).toBe("/interrupt-buffer?sprint=sprint_1");
    const item = server.rows.get(`workspace:interruptItem/${out.targetId}`) as InterruptItem;
    expect(item).toMatchObject({ sprintId: "sprint_1", emergency: true });
    const back = server.rows.get("workspace:bugReport/bug_a") as BugReport;
    expect(back.sentTo?.[0]).toMatchObject({ route: "interrupt", targetId: out.targetId });

    const planned = await run<{ targetId: string }>(
      "tool.bug_triage.send",
      { id: "bug_b", route: "backlog-story" },
      true
    );
    const story = server.rows.get(`workspace:story/${planned.targetId}`) as Story;
    expect(story).toMatchObject({ status: "backlog", tags: ["bug"] });
    expect(story.createdAt).toBeDefined();
    // The page's store saw none of it.
    expect(ws().bugReports).toEqual([]);

    // With no active sprint on the server, the interrupt is refused.
    server.rows.delete("workspace:sprint/sprint_1");
    server.rows.set("workspace:bugReport/bug_c", placed({ id: "bug_c" }));
    expect(
      await run("tool.bug_triage.send", { id: "bug_c", route: "interrupt" }, true)
    ).toMatchObject({ sent: false, reason: "no_sprint" });
  });
});

describe("suggest", () => {
  it("suggests by the rules for the queue, leaving out examples", async () => {
    useWorkspaceStore.setState({
      bugReports: [
        bug({
          id: "older",
          title: "Paying with a saved card fails",
          createdAt: "2026-11-10T09:00:00Z",
        }),
        bug({ id: "newer", title: "Paying with a saved card fails on a phone" }),
        bug({ id: "typo", title: "Typo on the delivery page", checks: { reach: "all" } }),
        bug({ id: "example-1", title: "Crash" }),
      ],
    });
    const out = await run<{
      suggestions: {
        id: string;
        severity: string;
        priority: string;
        duplicateOf?: string;
        duplicateOfTitle: string | null;
      }[];
    }>("tool.bug_triage.suggest");
    expect(out.suggestions.map((s) => s.id)).toEqual(["older", "newer", "typo"]);
    expect(out.suggestions[1]).toMatchObject({
      duplicateOf: "older",
      duplicateOfTitle: "Paying with a saved card fails",
    });
    expect(out.suggestions[2]).toMatchObject({ severity: "cosmetic", priority: "later" });
  });
});
