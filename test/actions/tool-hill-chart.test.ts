/**
 * tool.hill_chart.* coverage, in the browser and over MCP.
 *
 *   1. registration — one read and four writes, each with an MCP handler.
 *   2. list_state — sides, the stuck flag, the story's status and mismatch,
 *      the last check-in, and link states.
 *   3. add_scope — capped at 30; move_scope — stamps and reports done.
 *   4. check_in — one per day, refused on an empty chart.
 *   5. raise_stuck — only a stuck scope, never the example's, once; over
 *      MCP the impediment is the user's row and the scope records the link.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HillChart, HillScope, Impediment } from "@/lib/stores/workspace-types";

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
import "@/lib/actions/tools/hill-chart";

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

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const scope = (id: string, position: number, movedDaysAgo: number, over: Partial<HillScope> = {}) =>
  ({ id, title: `Scope ${id}`, position, movedAt: ago(movedDaysAgo), ...over }) as HillScope;
const chart = (over: Partial<HillChart> = {}): HillChart => ({
  id: "hill_a",
  title: "Refunds",
  scopes: [scope("s1", 30, 9, { storyId: "st1" }), scope("s2", 60, 1)],
  checkIns: [
    { id: "c1", at: ago(3), positions: [{ scopeId: "s1", position: 30 }], note: "Week 1" },
  ],
  createdAt: ago(20),
  updatedAt: ago(1),
  ...over,
});

const ws = () => useWorkspaceStore.getState();
const stored = (id = "hill_a") => (ws().hillCharts ?? []).find((c) => c.id === id);

beforeEach(() => {
  server.rows.clear();
  useWorkspaceStore.setState({
    hillCharts: [chart()],
    stories: [{ id: "st1", title: "API", status: "done" }],
    impediments: [],
  });
});

type ListOut = {
  charts: {
    id: string;
    lastCheckIn: { at: string; note: string | null } | null;
    scopes: {
      id: string;
      side: string;
      stuck: boolean;
      daysSinceMove: number;
      storyStatus: string | null;
      mismatch: string | null;
      sentTo: { target: string }[];
    }[];
  }[];
};

describe("registration", () => {
  it("has the read and the writes, each with an MCP handler", () => {
    expect(registry.get("tool.hill_chart.list_state")?.category).toBe("read");
    for (const name of ["add_scope", "move_scope", "check_in", "raise_stuck"]) {
      const a = registry.get(`tool.hill_chart.${name}`);
      expect(a?.category, name).toBe("write");
      expect(a?.requiresConfirmation, name).toBe(false);
      expect(a?.visitor, name).toBeUndefined();
    }
    for (const name of ["list_state", "add_scope", "move_scope", "check_in", "raise_stuck"]) {
      expect(registry.get(`tool.hill_chart.${name}`)?.mcpHandler, name).toBeTypeOf("function");
    }
  });
});

describe("list_state", () => {
  it("reports each scope's side, stuck flag, story status and mismatch, and the last check-in", async () => {
    const out = await run<ListOut>("tool.hill_chart.list_state");
    expect(out.charts).toHaveLength(1);
    const [c] = out.charts;
    expect(c.lastCheckIn).toMatchObject({ note: "Week 1" });
    expect(c.scopes[0]).toMatchObject({
      id: "s1",
      side: "uphill",
      stuck: true,
      daysSinceMove: 9,
      storyStatus: "done",
      mismatch: "story-done-uphill",
    });
    expect(c.scopes[1]).toMatchObject({ side: "downhill", stuck: false, mismatch: null });
  });

  it("filters to one chart", async () => {
    useWorkspaceStore.setState({ hillCharts: [chart(), chart({ id: "hill_b", title: "B" })] });
    const out = await run<ListOut>("tool.hill_chart.list_state", { chartId: "hill_b" });
    expect(out.charts.map((c) => c.id)).toEqual(["hill_b"]);
  });
});

describe("add_scope and move_scope", () => {
  it("adds a scope at 0 by default", async () => {
    const out = await run<{ added: boolean; scopeId: string; side: string }>(
      "tool.hill_chart.add_scope",
      { chartId: "hill_a", title: "Fraud checks" }
    );
    expect(out).toMatchObject({ added: true, side: "uphill" });
    expect(stored()?.scopes.at(-1)).toMatchObject({ title: "Fraud checks", position: 0 });
  });

  it("refuses a full chart and an unknown chart", async () => {
    useWorkspaceStore.setState({
      hillCharts: [chart({ scopes: Array.from({ length: 30 }, (_, i) => scope(`x${i}`, 0, 0)) })],
    });
    expect(
      await run("tool.hill_chart.add_scope", { chartId: "hill_a", title: "One more" })
    ).toMatchObject({ added: false, reason: "full" });
    expect(await run("tool.hill_chart.add_scope", { chartId: "nope", title: "X" })).toMatchObject({
      added: false,
      reason: "not_found",
    });
  });

  it("moves a scope, stamping when, and says when it reached done", async () => {
    const out = await run("tool.hill_chart.move_scope", {
      chartId: "hill_a",
      scopeId: "s2",
      position: 100,
    });
    expect(out).toEqual({ moved: true, from: 60, to: 100, side: "done", done: true });
    const s2 = stored()?.scopes[1];
    expect(s2?.doneAt).toBeTruthy();
    expect(Date.now() - Date.parse(s2?.movedAt ?? "")).toBeLessThan(5000);
    expect(
      await run("tool.hill_chart.move_scope", { chartId: "hill_a", scopeId: "s2", position: 100 })
    ).toMatchObject({ moved: false, reason: "unchanged" });
  });
});

describe("check_in", () => {
  it("saves today's positions, once a day", async () => {
    const first = await run<{ checkedIn: boolean; scopes: number; replacedToday: boolean }>(
      "tool.hill_chart.check_in",
      { chartId: "hill_a", note: "Week 2" }
    );
    expect(first).toMatchObject({ checkedIn: true, scopes: 2, replacedToday: false });
    const again = await run<{ replacedToday: boolean }>("tool.hill_chart.check_in", {
      chartId: "hill_a",
    });
    expect(again.replacedToday).toBe(true);
    expect(stored()?.checkIns).toHaveLength(2);
  });

  it("refuses an empty chart", async () => {
    useWorkspaceStore.setState({ hillCharts: [chart({ scopes: [] })] });
    expect(await run("tool.hill_chart.check_in", { chartId: "hill_a" })).toMatchObject({
      checkedIn: false,
      reason: "empty",
    });
  });
});

describe("raise_stuck", () => {
  it("raises a stuck scope as an impediment with a link both ways, once", async () => {
    const out = await run<{ raised: boolean; impedimentId: string }>(
      "tool.hill_chart.raise_stuck",
      { chartId: "hill_a", scopeId: "s1" }
    );
    expect(out.raised).toBe(true);
    const imp = (ws().impediments ?? [])[0];
    expect(imp).toMatchObject({
      id: out.impedimentId,
      title: "Scope s1",
      severity: "medium",
      sourceRef: { tool: "hill-chart", id: "s1", doc: "hill_a" },
    });
    expect(stored()?.scopes[0].sentTo?.[0]).toMatchObject({
      route: "impediment",
      targetId: out.impedimentId,
    });
    expect(
      await run("tool.hill_chart.raise_stuck", { chartId: "hill_a", scopeId: "s1" })
    ).toMatchObject({ raised: false, reason: "already_raised" });
    const listed = await run<ListOut>("tool.hill_chart.list_state");
    expect(listed.charts[0].scopes[0].sentTo[0].target).toBe("live");
  });

  it("refuses a scope that isn't stuck, and the example's", async () => {
    expect(
      await run("tool.hill_chart.raise_stuck", { chartId: "hill_a", scopeId: "s2" })
    ).toMatchObject({ raised: false, reason: "not_stuck" });
    useWorkspaceStore.setState({ hillCharts: [chart({ id: "example-hill" })] });
    expect(
      await run("tool.hill_chart.raise_stuck", { chartId: "example-hill", scopeId: "s1" })
    ).toMatchObject({ raised: false, reason: "example" });
  });

  it("writes the user's rows over MCP", async () => {
    server.rows.set("workspace:hillChart/hill_a", chart());
    const out = await run<{ raised: boolean; impedimentId: string }>(
      "tool.hill_chart.raise_stuck",
      { chartId: "hill_a", scopeId: "s1" },
      true
    );
    expect(out.raised).toBe(true);
    const imp = server.rows.get(`workspace:impediment/${out.impedimentId}`) as Impediment;
    expect(imp.sourceRef).toEqual({ tool: "hill-chart", id: "s1", doc: "hill_a" });
    const row = server.rows.get("workspace:hillChart/hill_a") as HillChart;
    expect(row.scopes[0].sentTo?.[0].targetId).toBe(out.impedimentId);
    // The browser's store is untouched.
    expect(ws().impediments).toEqual([]);
    const listed = await run<ListOut>("tool.hill_chart.list_state", {}, true);
    expect(listed.charts[0].scopes[0].sentTo[0].target).toBe("live");
  });
});
