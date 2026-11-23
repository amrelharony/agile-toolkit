/**
 * tool.impact_map.* coverage, in the browser and over MCP.
 *
 *   1. registration — one read and five writes, each with an MCP handler,
 *      none asking to confirm, every one open to a visitor's own data.
 *   2. create_map — from a goal, or from the active Product Goal (linked);
 *      a bad date and a missing Product Goal are refused.
 *   3. add_node — the level from the parent; a persona only on an actor
 *      and only one that exists; nothing under a deliverable; never on an
 *      example; the cap.
 *   4. set_focus — one impact; only impacts; clearing it.
 *   5. send_deliverable and test_impact — the target made with a link back,
 *      the link on the node, once while the target lives, again once it is
 *      gone, never from the wrong level or an example; over MCP the targets
 *      are the user's rows (a story, an epic in the roadmap doc, a drafted
 *      hypothesis in the tracker doc).
 *   6. list_state — counts without the examples, the linked goal's state,
 *      the checks and each link's target state.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  EpicRoadmap,
  HypothesisTracker,
  Persona,
  ProductGoal,
  Story,
  StrategyMap,
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
import { STRATEGY_NODES_MAX } from "@/lib/strategy-map/model";
import "@/lib/actions/tools/impact-map";
import { nearlyFull } from "../strategy-map/near-full";

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
  const a = registry.get(`tool.impact_map.${name}`)!;
  const handler = onServer ? (a.mcpHandler ?? a.handler) : a.handler;
  return (await handler(a.paramsSchema.parse(params), ctx(onServer ? "mcp" : "agent"))) as T;
};

const AT = "2026-11-20T09:00:00.000Z";
const map = (over: Partial<StrategyMap> = {}): StrategyMap => ({
  id: "strategyMap_m",
  format: "impact-map",
  title: "Grow repeat orders",
  nodes: [
    { id: "g", parentId: null, level: 0, text: "Grow repeat orders", measure: "Repeat rate" },
    { id: "a", parentId: "g", level: 1, text: "Busy parents" },
    { id: "i", parentId: "a", level: 2, text: "Skip a week instead of cancelling" },
    { id: "i2", parentId: "a", level: 2, text: "Reorder in two taps" },
    { id: "d", parentId: "i", level: 3, text: "Pause instead of cancel" },
  ],
  createdAt: AT,
  updatedAt: AT,
  ...over,
});
const goal = (over: Partial<ProductGoal> = {}): ProductGoal => ({
  id: "goal_1",
  statement: "Families eat well without planning",
  measures: ["Weekly active families"],
  targetDate: "2027-06-30",
  status: "active",
  createdAt: AT,
  updatedAt: AT,
  ...over,
});
const persona: Persona = {
  id: "persona_1",
  name: "Maya",
  role: "Shift worker",
  tier: "primary",
  evidence: "some",
  goals: [],
  pains: [],
  behaviours: [],
  tags: [],
  createdAt: AT,
  updatedAt: AT,
};

const ws = () => useWorkspaceStore.getState();
const stored = (id = "strategyMap_m") => (ws().strategyMaps ?? []).find((m) => m.id === id)!;
const nodeOf = (m: StrategyMap, id: string) => m.nodes.find((n) => n.id === id)!;

beforeEach(() => {
  server.rows.clear();
  useWorkspaceStore.setState({
    strategyMaps: [map()],
    personas: [persona],
    productGoals: [],
    stories: [],
    epicRoadmaps: [],
    hypothesisTrackers: [],
  });
});

describe("registration", () => {
  it("has one read and five writes, each with an MCP handler, open to visitors", () => {
    expect(registry.get("tool.impact_map.list_state")?.category).toBe("read");
    for (const name of ["create_map", "add_node", "set_focus", "send_deliverable", "test_impact"]) {
      const a = registry.get(`tool.impact_map.${name}`);
      expect(a?.category, name).toBe("write");
      expect(a?.requiresConfirmation, name).toBe(false);
      expect(a?.visitor, name).toBeUndefined();
    }
    for (const name of [
      "list_state",
      "create_map",
      "add_node",
      "set_focus",
      "send_deliverable",
      "test_impact",
    ]) {
      expect(registry.get(`tool.impact_map.${name}`)?.mcpHandler, name).toBeTypeOf("function");
    }
  });
});

describe("create_map", () => {
  it("starts a map from a goal, its root holding the measure", async () => {
    useWorkspaceStore.setState({ strategyMaps: [] });
    const r = await run<{ created: boolean; id: string; goalId: string }>("create_map", {
      goal: "  Grow repeat orders by 20%  ",
      measure: "Repeat rate",
      targetDate: "2027-06-30",
    });
    expect(r.created).toBe(true);
    const m = stored(r.id);
    expect(m).toMatchObject({
      format: "impact-map",
      title: "Grow repeat orders by 20%",
      targetDate: "2027-06-30",
    });
    expect(m.nodes).toEqual([
      {
        id: r.goalId,
        parentId: null,
        level: 0,
        text: "Grow repeat orders by 20%",
        measure: "Repeat rate",
      },
    ]);
    expect(strategyMapProblems(m, undefined)).toEqual([]);
  });

  it("starts from the active Product Goal and links it; a goal given still wins", async () => {
    useWorkspaceStore.setState({ strategyMaps: [], productGoals: [goal()] });
    const r = await run<{ created: boolean; id: string; productGoalId: string }>("create_map", {
      fromProductGoal: true,
    });
    expect(r).toMatchObject({ created: true, productGoalId: "goal_1" });
    expect(stored(r.id)).toMatchObject({
      title: "Families eat well without planning",
      productGoalId: "goal_1",
      targetDate: "2027-06-30",
    });
    expect(stored(r.id).nodes[0].measure).toBe("Weekly active families");
    const own = await run<{ id: string }>("create_map", {
      fromProductGoal: true,
      goal: "Fewer cancellations",
    });
    expect(stored(own.id).title).toBe("Fewer cancellations");
  });

  it("refuses a missing Product Goal, a bad date and no goal at all", async () => {
    useWorkspaceStore.setState({ strategyMaps: [], productGoals: [goal({ status: "achieved" })] });
    expect(await run("create_map", { fromProductGoal: true })).toMatchObject({
      created: false,
      reason: "no_product_goal",
    });
    expect(await run("create_map", { goal: "Grow", targetDate: "2027-02-30" })).toMatchObject({
      created: false,
      reason: "bad_date",
    });
    expect(() => registry.get("tool.impact_map.create_map")!.paramsSchema.parse({})).toThrow();
    expect(ws().strategyMaps).toEqual([]);
  });

  it("writes the user's row over MCP", async () => {
    const r = await run<{ id: string }>("create_map", { goal: "Grow repeat orders" }, true);
    expect(server.rows.get(`workspace:strategyMap/${r.id}`)).toMatchObject({
      format: "impact-map",
      title: "Grow repeat orders",
    });
  });
});

describe("add_node", () => {
  it("takes its level from the parent and links a persona on an actor", async () => {
    const actor = await run<{ added: boolean; id: string; level: number; kind: string }>(
      "add_node",
      { mapId: "strategyMap_m", parentId: "g", text: "Office lunch buyers", personaId: "persona_1" }
    );
    expect(actor).toMatchObject({ added: true, level: 1, kind: "actor" });
    expect(nodeOf(stored(), actor.id)).toMatchObject({ parentId: "g", personaId: "persona_1" });
    const del = await run<{ level: number; kind: string }>("add_node", {
      mapId: "strategyMap_m",
      parentId: "i2",
      text: "Favourites on the home screen",
      detail: "Top of the first screen.",
    });
    expect(del).toMatchObject({ level: 3, kind: "deliverable" });
    expect(strategyMapProblems(stored(), undefined)).toEqual([]);
  });

  it("refuses a child of a deliverable, a persona off the actor level or unknown, a measure below the goal", async () => {
    const add = (p: Record<string, unknown>) =>
      run("add_node", { mapId: "strategyMap_m", text: "x", ...p });
    expect(await add({ parentId: "d" })).toMatchObject({ added: false, reason: "leaf" });
    expect(await add({ parentId: "a", personaId: "persona_1" })).toMatchObject({
      added: false,
      reason: "persona_level",
    });
    expect(await add({ parentId: "g", personaId: "persona_gone" })).toMatchObject({
      added: false,
      reason: "unknown_persona",
    });
    expect(await add({ parentId: "a", measure: "Count" })).toMatchObject({
      added: false,
      reason: "measure_level",
    });
    expect(await add({ parentId: "ghost" })).toMatchObject({ reason: "parent_not_found" });
    expect(await run("add_node", { mapId: "nope", parentId: "g", text: "x" })).toMatchObject({
      reason: "not_found",
    });
    expect(stored().nodes).toHaveLength(5);
  });

  it("never adds to an example map, and stops at the cap", async () => {
    useWorkspaceStore.setState({ strategyMaps: [map({ id: "example-impact-map" })] });
    expect(
      await run("add_node", { mapId: "example-impact-map", parentId: "g", text: "x" })
    ).toMatchObject({ added: false, reason: "example" });
    const full = map();
    for (let n = full.nodes.length; n < STRATEGY_NODES_MAX; n++) {
      full.nodes.push({ id: `x${n}`, parentId: "g", level: 1, text: `Actor ${n}` });
    }
    useWorkspaceStore.setState({ strategyMaps: [full] });
    expect(
      await run("add_node", { mapId: full.id, parentId: "g", text: "One more" })
    ).toMatchObject({ added: false, reason: "full" });
  });

  it("never touches a strategy tree through the impact map's verbs", async () => {
    useWorkspaceStore.setState({
      strategyMaps: [
        {
          ...map({ id: "strategyMap_t", format: "dibb" }),
          nodes: [{ id: "r", parentId: null, level: 0, text: "Data", status: "proposed" }],
        },
      ],
    });
    expect(
      await run("add_node", { mapId: "strategyMap_t", parentId: "r", text: "x" })
    ).toMatchObject({ added: false, reason: "not_found" });
  });
});

describe("set_focus", () => {
  it("picks one impact, moves it, and clears it", async () => {
    expect(await run("set_focus", { mapId: "strategyMap_m", impactId: "i" })).toMatchObject({
      updated: true,
      focus: "i",
      previous: null,
    });
    expect(await run("set_focus", { mapId: "strategyMap_m", impactId: "i2" })).toMatchObject({
      updated: true,
      previous: "i",
    });
    expect(
      stored()
        .nodes.filter((n) => n.focus)
        .map((n) => n.id)
    ).toEqual(["i2"]);
    expect(await run("set_focus", { mapId: "strategyMap_m", impactId: "i2" })).toMatchObject({
      updated: false,
      reason: "unchanged",
    });
    expect(await run("set_focus", { mapId: "strategyMap_m", impactId: null })).toMatchObject({
      updated: true,
      focus: null,
    });
    expect(stored().nodes.some((n) => n.focus)).toBe(false);
  });

  it("refuses anything but an impact", async () => {
    expect(await run("set_focus", { mapId: "strategyMap_m", impactId: "a" })).toMatchObject({
      updated: false,
      reason: "not_impact",
    });
    expect(await run("set_focus", { mapId: "strategyMap_m", impactId: "nope" })).toMatchObject({
      reason: "node_not_found",
    });
  });
});

describe("send_deliverable and test_impact, in the browser", () => {
  it("puts a deliverable on the backlog with a link back, once while it lives", async () => {
    const r = await run<{ sent: boolean; targetId: string; route: string }>("send_deliverable", {
      mapId: "strategyMap_m",
      nodeId: "d",
      to: "backlog-story",
    });
    expect(r).toMatchObject({ sent: true, route: "backlog-story" });
    const story = ws().stories.find((s) => s.id === r.targetId)!;
    expect(story).toMatchObject({
      title: "Pause instead of cancel",
      status: "backlog",
      sourceRef: { tool: "impact-map", id: "d", doc: "strategyMap_m" },
    });
    expect(story.notes).toContain("For Busy parents: Skip a week instead of cancelling.");
    expect(nodeOf(stored(), "d").sentTo).toEqual([
      expect.objectContaining({ route: "backlog-story", targetId: r.targetId }),
    ]);
    expect(
      await run("send_deliverable", { mapId: "strategyMap_m", nodeId: "d", to: "backlog-story" })
    ).toMatchObject({ sent: false, reason: "already_sent", targetId: r.targetId });
    // Deleted on the backlog: it can go again.
    useWorkspaceStore.setState({ stories: [] });
    expect(
      await run("send_deliverable", { mapId: "strategyMap_m", nodeId: "d", to: "backlog-story" })
    ).toMatchObject({ sent: true });
    expect(ws().stories).toHaveLength(1);
  });

  it("puts a deliverable on the roadmap as an epic", async () => {
    const r = await run<{ sent: boolean; targetId: string }>("send_deliverable", {
      mapId: "strategyMap_m",
      nodeId: "d",
      to: "epic",
    });
    expect(r.sent).toBe(true);
    const epic = (ws().epicRoadmaps ?? [])[0].epics.find((e) => e.id === r.targetId);
    expect(epic).toMatchObject({
      title: "Pause instead of cancel",
      sourceRef: { tool: "impact-map", id: "d", doc: "strategyMap_m" },
    });
  });

  it("tests an impact as a drafted hypothesis with the goal's measure", async () => {
    const r = await run<{ sent: boolean; targetId: string }>("test_impact", {
      mapId: "strategyMap_m",
      nodeId: "i",
    });
    expect(r.sent).toBe(true);
    const h = (ws().hypothesisTrackers ?? [])[0].hypotheses.find((x) => x.id === r.targetId)!;
    expect(h).toMatchObject({
      status: "drafted",
      willDo: "Pause instead of cancel",
      successMetric: "Repeat rate",
      sourceRef: { tool: "impact-map", id: "i", doc: "strategyMap_m" },
    });
    expect(h.believe).toMatch(/Pause instead of cancel will lead Busy parents to skip a week/);
  });

  it("refuses the wrong level, an example and an unknown node", async () => {
    expect(
      await run("send_deliverable", { mapId: "strategyMap_m", nodeId: "i", to: "epic" })
    ).toMatchObject({ sent: false, reason: "level" });
    expect(await run("test_impact", { mapId: "strategyMap_m", nodeId: "d" })).toMatchObject({
      sent: false,
      reason: "level",
    });
    expect(await run("test_impact", { mapId: "strategyMap_m", nodeId: "zz" })).toMatchObject({
      reason: "not_found",
    });
    useWorkspaceStore.setState({ strategyMaps: [map({ id: "example-impact-map" })] });
    expect(
      await run("send_deliverable", {
        mapId: "example-impact-map",
        nodeId: "d",
        to: "backlog-story",
      })
    ).toMatchObject({ sent: false, reason: "example" });
    expect(ws().stories).toEqual([]);
  });

  it("refuses a row that can't hold the link before it makes anything, retry after retry", async () => {
    const full = nearlyFull(map());
    useWorkspaceStore.setState({ strategyMaps: [full] });
    const tries = [
      ["send_deliverable", { mapId: "strategyMap_m", nodeId: "d", to: "backlog-story" }],
      ["send_deliverable", { mapId: "strategyMap_m", nodeId: "d", to: "backlog-story" }],
      ["send_deliverable", { mapId: "strategyMap_m", nodeId: "d", to: "epic" }],
      ["test_impact", { mapId: "strategyMap_m", nodeId: "i" }],
    ] as const;
    for (const [name, params] of tries) {
      const r = await run(name, params);
      expect(r).toMatchObject({ sent: false, reason: "too_big" });
      expect(r).not.toHaveProperty("targetId");
    }
    expect(ws().stories).toEqual([]);
    expect(ws().epicRoadmaps).toEqual([]);
    expect(ws().hypothesisTrackers).toEqual([]);
    expect(stored()).toEqual(full);
  });
});

describe("over MCP", () => {
  beforeEach(() => {
    server.rows.set("workspace:strategyMap/strategyMap_m", map());
  });

  it("writes the story, the epic and the hypothesis to the user's rows, linked back", async () => {
    const story = await run<{ targetId: string }>(
      "send_deliverable",
      { mapId: "strategyMap_m", nodeId: "d", to: "backlog-story" },
      true
    );
    expect(server.rows.get(`workspace:story/${story.targetId}`)).toMatchObject({
      title: "Pause instead of cancel",
      sourceRef: { tool: "impact-map", id: "d", doc: "strategyMap_m" },
    });
    const epic = await run<{ targetId: string }>(
      "send_deliverable",
      { mapId: "strategyMap_m", nodeId: "d", to: "epic" },
      true
    );
    const doc = server.rows.get("workspace:epicRoadmap/epicRoadmap:current") as EpicRoadmap;
    expect(doc.epics.map((e) => e.id)).toEqual([epic.targetId]);
    const test = await run<{ targetId: string }>(
      "test_impact",
      { mapId: "strategyMap_m", nodeId: "i" },
      true
    );
    const tracker = server.rows.get(
      "workspace:hypothesisTracker/hypothesisTracker:current"
    ) as HypothesisTracker;
    expect(tracker.hypotheses.map((h) => h.id)).toEqual([test.targetId]);
    const saved = server.rows.get("workspace:strategyMap/strategyMap_m") as StrategyMap;
    expect(
      nodeOf(saved, "d")
        .sentTo?.map((l) => l.route)
        .sort()
    ).toEqual(["backlog-story", "epic"]);
    expect(nodeOf(saved, "i").sentTo?.map((l) => l.route)).toEqual(["hypothesis"]);
    // The browser's store is never touched.
    expect(ws().stories).toEqual([]);
  });

  it("writes no story, epic or hypothesis when the map's row can't hold the link", async () => {
    server.rows.set("workspace:strategyMap/strategyMap_m", nearlyFull(map()));
    for (const [name, params] of [
      ["send_deliverable", { mapId: "strategyMap_m", nodeId: "d", to: "backlog-story" }],
      ["send_deliverable", { mapId: "strategyMap_m", nodeId: "d", to: "epic" }],
      ["test_impact", { mapId: "strategyMap_m", nodeId: "i" }],
    ] as const) {
      expect(await run(name, params, true)).toMatchObject({ sent: false, reason: "too_big" });
    }
    expect(Array.from(server.rows.keys())).toEqual(["workspace:strategyMap/strategyMap_m"]);
  });

  it("sends again only once the server's target is gone", async () => {
    const first = await run<{ targetId: string }>(
      "send_deliverable",
      { mapId: "strategyMap_m", nodeId: "d", to: "backlog-story" },
      true
    );
    expect(
      await run(
        "send_deliverable",
        { mapId: "strategyMap_m", nodeId: "d", to: "backlog-story" },
        true
      )
    ).toMatchObject({ sent: false, reason: "already_sent" });
    server.rows.delete(`workspace:story/${first.targetId}`);
    expect(
      await run(
        "send_deliverable",
        { mapId: "strategyMap_m", nodeId: "d", to: "backlog-story" },
        true
      )
    ).toMatchObject({ sent: true });
  });

  it("reads a synced row the way the page does", async () => {
    server.rows.set("workspace:strategyMap/strategyMap_o", {
      ...map({ id: "strategyMap_o" }),
      nodes: [
        { id: "g", parentId: null, level: 0, text: "Goal" },
        { id: "lost", parentId: "gone", level: 2, text: "An orphan" },
      ],
    } as StrategyMap);
    const r = await run<{ maps: { id: string; nodes: { id: string; level: number }[] }[] }>(
      "list_state",
      {},
      true
    );
    const o = r.maps.find((m) => m.id === "strategyMap_o")!;
    expect(o.nodes).toEqual([
      expect.objectContaining({ id: "g", level: 0 }),
      expect.objectContaining({ id: "lost", level: 1 }),
    ]);
  });
});

describe("list_state", () => {
  it("summarises the maps, examples left out of the totals", async () => {
    const story: Story = { id: "story_1", title: "Pause instead of cancel", status: "done" };
    useWorkspaceStore.setState({
      productGoals: [goal({ status: "achieved" })],
      stories: [story],
      strategyMaps: [
        map({
          productGoalId: "goal_1",
          nodes: map().nodes.map((n) =>
            n.id === "d"
              ? { ...n, sentTo: [{ route: "backlog-story", targetId: "story_1", at: AT }] }
              : n.id === "i"
                ? { ...n, focus: true }
                : n
          ),
        }),
        map({ id: "example-impact-map", productGoalId: "goal_gone" }),
      ],
    });
    const r = await run<{
      totals: Record<string, number>;
      examples: number;
      maps: {
        id: string;
        productGoal: unknown;
        counts: Record<string, number>;
        focus: { id: string } | null;
        checks: string[];
        nodes: { id: string; sentTo?: { target: string }[] }[];
      }[];
    }>("list_state");
    expect(r.totals).toEqual({ maps: 1, actors: 1, impacts: 2, deliverables: 1 });
    expect(r.examples).toBe(1);
    const own = r.maps.find((m) => m.id === "strategyMap_m")!;
    expect(own.productGoal).toEqual({ id: "goal_1", status: "achieved" });
    expect(own.counts).toEqual({ actors: 1, impacts: 2, deliverables: 1 });
    expect(own.focus?.id).toBe("i");
    expect(own.checks).toContain("“Reorder in two taps” has no deliverables yet.");
    expect(own.nodes.find((n) => n.id === "d")?.sentTo).toEqual([
      expect.objectContaining({ target: "done" }),
    ]);
    expect(r.maps.find((m) => m.id === "example-impact-map")?.productGoal).toEqual({
      id: "goal_gone",
      gone: true,
    });
  });

  it("leaves strategy trees to tool.strategy_tree", async () => {
    useWorkspaceStore.setState({
      strategyMaps: [
        map(),
        {
          ...map({ id: "strategyMap_t", format: "hoshin" }),
          nodes: [{ id: "r", parentId: null, level: 0, text: "Aim", status: "proposed" }],
        },
      ],
    });
    const r = await run<{ maps: { id: string }[] }>("list_state");
    expect(r.maps.map((m) => m.id)).toEqual(["strategyMap_m"]);
  });
});
