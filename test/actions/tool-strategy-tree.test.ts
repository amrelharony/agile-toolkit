/**
 * tool.strategy_tree.* coverage, in the browser and over MCP.
 *
 *   1. registration — one read and four writes, each with an MCP handler,
 *      none asking to confirm, every one open to a visitor's own data.
 *   2. create_tree — in a shape, its root proposed; the impact map isn't a
 *      shape here.
 *   3. add_node — the level from the parent, a measure and an owner only
 *      where the level has one, nothing under the last level, never on an
 *      example.
 *   4. set_status — the catchball's note, and treeAgreed only on the change
 *      that agrees the last part.
 *   5. send — a bet to the Hypothesis Tracker, an initiative or priority to
 *      the roadmap, by shape and level, never a dropped part, once while the
 *      target lives; over MCP to the user's rows.
 *   6. list_state — statuses, agreed, checks, the trees only.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EpicRoadmap, HypothesisTracker, StrategyMap } from "@/lib/stores/workspace-types";

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
    serverGetEntity: vi.fn(async (_u: string, kind: string, id: string) =>
      server.rows.get(key(kind, id))
    ),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, e: { id: string }) => {
      server.rows.set(key(kind, e.id), e);
    }),
  };
});

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { strategyMapProblems } from "@/lib/strategy-map/rules";
import "@/lib/actions/tools/strategy-tree";
import { nearlyFull } from "../strategy-map/near-full";
import { fullTracker } from "../hypotheses/full-tracker";
import { TRACKER_FULL } from "@/lib/hypotheses/model";

const ctx = (source: "agent" | "mcp" = "agent") => ({
  userId: "u",
  source,
  squadProfileIds: [] as string[],
});
const run = async <T = Record<string, unknown>>(
  name: string,
  params: Record<string, unknown> = {},
  onServer = false
) => {
  const a = registry.get(`tool.strategy_tree.${name}`)!;
  const handler = onServer ? (a.mcpHandler ?? a.handler) : a.handler;
  return (await handler(a.paramsSchema.parse(params), ctx(onServer ? "mcp" : "agent"))) as T;
};

const AT = "2026-11-20T09:00:00.000Z";
/** A Lean Value Tree: vision, a goal, a bet and an initiative. */
const lvt = (over: Partial<StrategyMap> = {}): StrategyMap => ({
  id: "strategyMap_l",
  format: "lean-value-tree",
  title: "Good dinners without the planning",
  nodes: [
    {
      id: "v",
      parentId: null,
      level: 0,
      text: "Good dinners without the planning",
      status: "agreed",
    },
    {
      id: "g",
      parentId: "v",
      level: 1,
      text: "Customers order again within a month",
      measure: "Repeat rate",
      status: "agreed",
    },
    {
      id: "b",
      parentId: "g",
      level: 2,
      text: "A favourites list makes reordering easy",
      status: "proposed",
    },
    {
      id: "in",
      parentId: "b",
      level: 3,
      text: "Favourites on the home screen",
      owner: "App team",
      status: "proposed",
    },
  ],
  createdAt: AT,
  updatedAt: AT,
  ...over,
});
/** A DIBB tree down to one bet. */
const dibb = (): StrategyMap => ({
  id: "strategyMap_d",
  format: "dibb",
  title: "Cancellations",
  nodes: [
    { id: "da", parentId: null, level: 0, text: "4 in 10 cancel after a price change" },
    { id: "ins", parentId: "da", level: 1, text: "The price surprises them" },
    { id: "bel", parentId: "ins", level: 2, text: "Warning ahead keeps more of them" },
    {
      id: "bet",
      parentId: "bel",
      level: 3,
      text: "Email two weeks before",
      measure: "Cancellations that week",
    },
  ],
  createdAt: AT,
  updatedAt: AT,
});
const hoshin = (): StrategyMap => ({
  id: "strategyMap_h",
  format: "hoshin",
  title: "Repeat customers",
  nodes: [
    { id: "aim", parentId: null, level: 0, text: "Half of orders from repeat customers" },
    { id: "ann", parentId: "aim", level: 1, text: "A third by December", measure: "Share" },
    { id: "pri", parentId: "ann", level: 2, text: "Make skipping easy", owner: "Product team" },
  ],
  createdAt: AT,
  updatedAt: AT,
});

const ws = () => useWorkspaceStore.getState();
const stored = (id: string) => (ws().strategyMaps ?? []).find((m) => m.id === id)!;
const nodeOf = (m: StrategyMap, id: string) => m.nodes.find((n) => n.id === id)!;

beforeEach(() => {
  server.rows.clear();
  useWorkspaceStore.setState({
    strategyMaps: [lvt(), dibb(), hoshin()],
    stories: [],
    epicRoadmaps: [],
    hypothesisTrackers: [],
  });
});

describe("registration", () => {
  it("has one read and four writes, each with an MCP handler, open to visitors", () => {
    expect(registry.get("tool.strategy_tree.list_state")?.category).toBe("read");
    for (const name of ["create_tree", "add_node", "set_status", "send"]) {
      const a = registry.get(`tool.strategy_tree.${name}`);
      expect(a?.category, name).toBe("write");
      expect(a?.requiresConfirmation, name).toBe(false);
      expect(a?.visitor, name).toBeUndefined();
    }
    for (const name of ["list_state", "create_tree", "add_node", "set_status", "send"]) {
      expect(registry.get(`tool.strategy_tree.${name}`)?.mcpHandler, name).toBeTypeOf("function");
    }
  });
});

describe("create_tree", () => {
  it("starts a tree in its shape, the root proposed", async () => {
    const r = await run<{ created: boolean; id: string; rootId: string; format: string }>(
      "create_tree",
      { format: "hoshin", root: "Half of all orders from repeat customers" }
    );
    expect(r).toMatchObject({ created: true, format: "hoshin" });
    const t = stored(r.id);
    expect(t.title).toBe("Half of all orders from repeat customers");
    expect(t.nodes).toEqual([
      {
        id: r.rootId,
        parentId: null,
        level: 0,
        text: "Half of all orders from repeat customers",
        status: "proposed",
      },
    ]);
    expect(strategyMapProblems(t, undefined)).toEqual([]);
  });

  it("takes a title, and isn't how an impact map is made", async () => {
    const r = await run<{ id: string }>("create_tree", {
      format: "dibb",
      root: "Most cancel in week one",
      title: "Week one",
    });
    expect(stored(r.id).title).toBe("Week one");
    const schema = registry.get("tool.strategy_tree.create_tree")!.paramsSchema;
    expect(() => schema.parse({ format: "impact-map", root: "Goal" })).toThrow();
    expect(await run("create_tree", { format: "dibb", root: "   " })).toMatchObject({
      created: false,
      reason: "blank",
    });
  });

  it("writes the user's row over MCP", async () => {
    const r = await run<{ id: string }>(
      "create_tree",
      { format: "lean-value-tree", root: "Good dinners" },
      true
    );
    expect(server.rows.get(`workspace:strategyMap/${r.id}`)).toMatchObject({
      format: "lean-value-tree",
    });
  });
});

describe("add_node", () => {
  it("takes the level from the parent, with the fields that level has", async () => {
    const r = await run<{ added: boolean; id: string; level: number; kind: string }>("add_node", {
      treeId: "strategyMap_h",
      parentId: "pri",
      text: "Fewer than 1 in 10 leave the cancel page",
      measure: "Cancel page exits",
      owner: "Product team",
    });
    expect(r).toMatchObject({ added: true, level: 3, kind: "Target" });
    expect(nodeOf(stored("strategyMap_h"), r.id)).toMatchObject({
      measure: "Cancel page exits",
      owner: "Product team",
      status: "proposed",
    });
  });

  it("refuses a measure or an owner where the level has none, and under the last level", async () => {
    expect(
      await run("add_node", {
        treeId: "strategyMap_d",
        parentId: "da",
        text: "Another insight",
        measure: "x",
      })
    ).toMatchObject({ added: false, reason: "field_level" });
    expect(
      await run("add_node", {
        treeId: "strategyMap_d",
        parentId: "ins",
        text: "A belief",
        owner: "Ana",
      })
    ).toMatchObject({ added: false, reason: "field_level" });
    expect(
      await run("add_node", { treeId: "strategyMap_d", parentId: "bet", text: "Below a bet" })
    ).toMatchObject({ added: false, reason: "leaf" });
    expect(stored("strategyMap_d").nodes).toHaveLength(4);
  });

  it("never adds to an example tree or an impact map", async () => {
    useWorkspaceStore.setState({
      strategyMaps: [
        { ...dibb(), id: "example-strategy-tree-dibb" },
        {
          ...dibb(),
          id: "strategyMap_i",
          format: "impact-map",
          nodes: [{ id: "g", parentId: null, level: 0, text: "Goal" }],
        },
      ],
    });
    expect(
      await run("add_node", { treeId: "example-strategy-tree-dibb", parentId: "da", text: "x" })
    ).toMatchObject({ added: false, reason: "example" });
    expect(
      await run("add_node", { treeId: "strategyMap_i", parentId: "g", text: "x" })
    ).toMatchObject({ added: false, reason: "not_found" });
  });
});

describe("set_status", () => {
  it("keeps the catchball's question as the note, and removes it with ''", async () => {
    await run("set_status", {
      treeId: "strategyMap_h",
      nodeId: "pri",
      status: "questioned",
      note: "Who owns win-back emails?",
    });
    expect(nodeOf(stored("strategyMap_h"), "pri")).toMatchObject({
      status: "questioned",
      note: "Who owns win-back emails?",
    });
    await run("set_status", { treeId: "strategyMap_h", nodeId: "pri", status: "agreed", note: "" });
    expect(nodeOf(stored("strategyMap_h"), "pri")).not.toHaveProperty("note");
  });

  it("says the tree is agreed only on the change that agrees its last part", async () => {
    const first = await run("set_status", {
      treeId: "strategyMap_l",
      nodeId: "b",
      status: "agreed",
    });
    expect(first).toMatchObject({ updated: true, previous: "proposed", treeAgreed: false });
    const last = await run("set_status", {
      treeId: "strategyMap_l",
      nodeId: "in",
      status: "agreed",
    });
    expect(last).toMatchObject({ updated: true, treeAgreed: true });
    const again = await run("set_status", {
      treeId: "strategyMap_l",
      nodeId: "in",
      status: "agreed",
    });
    expect(again).toMatchObject({ treeAgreed: false });
    // Dropping the part that held out also makes it agreed.
    useWorkspaceStore.setState({ strategyMaps: [lvt()] });
    await run("set_status", { treeId: "strategyMap_l", nodeId: "b", status: "agreed" });
    expect(
      await run("set_status", { treeId: "strategyMap_l", nodeId: "in", status: "dropped" })
    ).toMatchObject({ treeAgreed: true });
  });

  it("refuses an unknown part or an example tree", async () => {
    expect(
      await run("set_status", { treeId: "strategyMap_l", nodeId: "zz", status: "agreed" })
    ).toMatchObject({ updated: false, reason: "node_not_found" });
    useWorkspaceStore.setState({ strategyMaps: [{ ...lvt(), id: "example-x" }] });
    expect(
      await run("set_status", { treeId: "example-x", nodeId: "b", status: "agreed" })
    ).toMatchObject({ updated: false, reason: "example" });
  });
});

describe("send, in the browser", () => {
  it("tests a Lean Value Tree bet, its initiatives as what we'll do", async () => {
    const r = await run<{ sent: boolean; route: string; targetId: string }>("send", {
      treeId: "strategyMap_l",
      nodeId: "b",
      to: "hypothesis",
    });
    expect(r).toMatchObject({ sent: true, route: "hypothesis" });
    const h = (ws().hypothesisTrackers ?? [])[0].hypotheses[0];
    expect(h).toMatchObject({
      id: r.targetId,
      willDo: "Favourites on the home screen",
      successMetric: "Repeat rate",
      toLearn: "Whether it moves the goal: Customers order again within a month",
      sourceRef: { tool: "strategy-tree", id: "b", doc: "strategyMap_l" },
    });
    expect(nodeOf(stored("strategyMap_l"), "b").sentTo).toEqual([
      expect.objectContaining({ route: "hypothesis", targetId: r.targetId }),
    ]);
    expect(
      await run("send", { treeId: "strategyMap_l", nodeId: "b", to: "hypothesis" })
    ).toMatchObject({ sent: false, reason: "already_sent" });
  });

  it("tests a DIBB bet against the belief above it", async () => {
    await run("send", { treeId: "strategyMap_d", nodeId: "bet", to: "hypothesis" });
    const h = (ws().hypothesisTrackers ?? [])[0].hypotheses[0];
    expect(h.willDo).toBe("Email two weeks before");
    expect(h.successMetric).toBe("Cancellations that week");
    expect(h.toLearn).toContain("4 in 10 cancel after a price change");
  });

  it("puts an initiative or a priority on the roadmap, with its path and owner", async () => {
    const a = await run<{ targetId: string }>("send", {
      treeId: "strategyMap_l",
      nodeId: "in",
      to: "epic",
    });
    const b = await run<{ targetId: string }>("send", {
      treeId: "strategyMap_h",
      nodeId: "pri",
      to: "epic",
    });
    const epics = (ws().epicRoadmaps ?? [])[0].epics;
    expect(epics.find((e) => e.id === a.targetId)).toMatchObject({
      title: "Favourites on the home screen",
      owner: "App team",
      sourceRef: { tool: "strategy-tree", id: "in", doc: "strategyMap_l" },
    });
    expect(epics.find((e) => e.id === a.targetId)?.description).toMatch(/^Part of: /);
    expect(epics.find((e) => e.id === b.targetId)?.owner).toBe("Product team");
  });

  it("refuses a level a route doesn't take, and a dropped part", async () => {
    expect(
      await run("send", { treeId: "strategyMap_d", nodeId: "bel", to: "hypothesis" })
    ).toMatchObject({ sent: false, reason: "level" });
    expect(await run("send", { treeId: "strategyMap_d", nodeId: "bet", to: "epic" })).toMatchObject(
      { sent: false, reason: "level" }
    );
    expect(
      await run("send", { treeId: "strategyMap_h", nodeId: "pri", to: "hypothesis" })
    ).toMatchObject({ sent: false, reason: "level" });
    useWorkspaceStore.setState({
      strategyMaps: [
        {
          ...lvt(),
          nodes: lvt().nodes.map((n) => (n.id === "b" ? { ...n, status: "dropped" as const } : n)),
        },
      ],
    });
    expect(
      await run("send", { treeId: "strategyMap_l", nodeId: "b", to: "hypothesis" })
    ).toMatchObject({ sent: false, reason: "level" });
    expect(ws().hypothesisTrackers).toEqual([]);
  });

  it("refuses a row that can't hold the link before it makes anything, retry after retry", async () => {
    const full = nearlyFull(lvt());
    useWorkspaceStore.setState({ strategyMaps: [full] });
    for (const to of ["hypothesis", "hypothesis", "epic"] as const) {
      const r = await run("send", {
        treeId: "strategyMap_l",
        nodeId: to === "epic" ? "in" : "b",
        to,
      });
      expect(r).toMatchObject({ sent: false, reason: "too_big" });
      expect(r).not.toHaveProperty("targetId");
    }
    expect(ws().hypothesisTrackers).toEqual([]);
    expect(ws().epicRoadmaps).toEqual([]);
    expect(stored("strategyMap_l")).toEqual(full);
  });

  it("refuses to test a bet while the Hypothesis Tracker is full, as the page's button does", async () => {
    const tracker = fullTracker();
    useWorkspaceStore.setState({ hypothesisTrackers: [tracker] });
    expect(await run("send", { treeId: "strategyMap_l", nodeId: "b", to: "hypothesis" })).toEqual({
      sent: false,
      reason: "too_big",
      message: TRACKER_FULL,
    });
    expect(ws().hypothesisTrackers).toEqual([tracker]);
    expect(nodeOf(stored("strategyMap_l"), "b").sentTo).toBeUndefined();
  });
});

describe("over MCP", () => {
  beforeEach(() => {
    server.rows.set("workspace:strategyMap/strategyMap_l", lvt());
  });

  it("writes the hypothesis and the epic to the user's rows, linked back", async () => {
    const h = await run<{ targetId: string }>(
      "send",
      { treeId: "strategyMap_l", nodeId: "b", to: "hypothesis" },
      true
    );
    const e = await run<{ targetId: string }>(
      "send",
      { treeId: "strategyMap_l", nodeId: "in", to: "epic" },
      true
    );
    const tracker = server.rows.get(
      "workspace:hypothesisTracker/hypothesisTracker:current"
    ) as HypothesisTracker;
    expect(tracker.hypotheses.map((x) => x.id)).toEqual([h.targetId]);
    const roadmap = server.rows.get("workspace:epicRoadmap/epicRoadmap:current") as EpicRoadmap;
    expect(roadmap.epics.map((x) => x.id)).toEqual([e.targetId]);
    const saved = server.rows.get("workspace:strategyMap/strategyMap_l") as StrategyMap;
    expect(nodeOf(saved, "b").sentTo?.[0]).toMatchObject({ route: "hypothesis" });
    expect(nodeOf(saved, "in").sentTo?.[0]).toMatchObject({ route: "epic" });
    expect(ws().hypothesisTrackers).toEqual([]);
  });

  it("writes no hypothesis or epic when the tree's row can't hold the link", async () => {
    server.rows.set("workspace:strategyMap/strategyMap_l", nearlyFull(lvt()));
    expect(
      await run("send", { treeId: "strategyMap_l", nodeId: "b", to: "hypothesis" }, true)
    ).toMatchObject({ sent: false, reason: "too_big" });
    expect(
      await run("send", { treeId: "strategyMap_l", nodeId: "in", to: "epic" }, true)
    ).toMatchObject({ sent: false, reason: "too_big" });
    expect(Array.from(server.rows.keys())).toEqual(["workspace:strategyMap/strategyMap_l"]);
  });

  it("writes no hypothesis and no link while the user's Hypothesis Tracker is full", async () => {
    const tracker = fullTracker();
    const TRACKER_ROW = "workspace:hypothesisTracker/hypothesisTracker:current";
    server.rows.set(TRACKER_ROW, tracker);
    expect(
      await run("send", { treeId: "strategyMap_l", nodeId: "b", to: "hypothesis" }, true)
    ).toEqual({ sent: false, reason: "too_big", message: TRACKER_FULL });
    expect(server.rows.get(TRACKER_ROW)).toEqual(tracker);
    const saved = server.rows.get("workspace:strategyMap/strategyMap_l") as StrategyMap;
    expect(nodeOf(saved, "b").sentTo).toBeUndefined();
    // The epic still goes: only the tracker is full.
    expect(
      await run("send", { treeId: "strategyMap_l", nodeId: "in", to: "epic" }, true)
    ).toMatchObject({ sent: true });
  });

  it("sets a status on the user's row", async () => {
    const r = await run(
      "set_status",
      { treeId: "strategyMap_l", nodeId: "b", status: "questioned", note: "Test first?" },
      true
    );
    expect(r).toMatchObject({ updated: true });
    const saved = server.rows.get("workspace:strategyMap/strategyMap_l") as StrategyMap;
    expect(nodeOf(saved, "b")).toMatchObject({ status: "questioned", note: "Test first?" });
  });
});

describe("list_state", () => {
  it("summarises the trees with their statuses and checks, impact maps left out", async () => {
    useWorkspaceStore.setState({
      strategyMaps: [
        lvt(),
        hoshin(),
        {
          ...lvt({ id: "strategyMap_i", format: "impact-map" }),
          nodes: [{ id: "g", parentId: null, level: 0, text: "Goal" }],
        },
        { ...dibb(), id: "example-strategy-tree-dibb" },
      ],
    });
    const r = await run<{
      total: number;
      examples: number;
      trees: {
        id: string;
        levels: string[];
        statuses: Record<string, number>;
        agreed: boolean;
        checks: string[];
      }[];
    }>("list_state");
    expect(r.total).toBe(2);
    expect(r.examples).toBe(1);
    expect(r.trees.map((t) => t.id).sort()).toEqual([
      "example-strategy-tree-dibb",
      "strategyMap_h",
      "strategyMap_l",
    ]);
    const l = r.trees.find((t) => t.id === "strategyMap_l")!;
    expect(l.levels).toEqual(["Vision", "Goal", "Bet", "Initiative"]);
    expect(l.statuses).toEqual({ proposed: 2, agreed: 2, questioned: 0, dropped: 0 });
    expect(l.agreed).toBe(false);
    expect(l.checks).toContain("“A favourites list makes reordering easy” needs a measure.");
    expect(l.checks).toContain("“A favourites list makes reordering easy” isn't tested yet.");
    const h = r.trees.find((t) => t.id === "strategyMap_h")!;
    expect(h.checks.some((c) => c.includes("catchball"))).toBe(true);
  });
});
