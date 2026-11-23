/**
 * The strategy maps' store cases beyond the base's phase43 tests (chain
 * C08: Impact Map and Strategy Tree). One collection holds both tools'
 * maps: what the pages write rides the store, export and import as it is,
 * reads back unchanged, keeps the rules, and validates through the CRUD,
 * so an agent's update of a map the page saved is never refused. A row a
 * sync or an import brings that breaks the rules stays as stored, and the
 * pages and verbs read it into one that keeps them.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverUpsertEntity: vi.fn(async () => {}),
    serverListEntities: vi.fn(async () => []),
    serverGetEntity: vi.fn(async () => null),
    serverDeleteEntity: vi.fn(async () => {}),
  };
});

import { registry } from "@/lib/actions/registry";
import "@/lib/actions/workspace";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { StrategyMap } from "@/lib/stores/workspace-types";
import { isTreeFormat } from "@/lib/strategy-map/formats";
import {
  newStrategyMap,
  readStrategyMap,
  readStrategyMaps,
  withFocus,
  withNode,
  withNodePatch,
  withStatus,
} from "@/lib/strategy-map/model";
import { strategyMapProblems } from "@/lib/strategy-map/rules";
import { isExampleId } from "@/lib/utils/example-id";
import { buildExample as impactExample } from "@/app/(tools)/impact-map/example";
import { buildExamples as treeExamples } from "@/app/(tools)/strategy-tree/example";
import { IMPACT_MAP, STRATEGY_TREE } from "./phase43-fixtures";

const ws = () => useWorkspaceStore.getState();
const maps = () => ws().strategyMaps ?? [];
const NOW = new Date("2026-11-20T09:00:00.000Z");
const AT = NOW.toISOString();

/** An impact map as the page builds it: a goal, an actor, a focus impact and a sent deliverable. */
function pageMap(): StrategyMap {
  let m = newStrategyMap({
    id: "strategyMap_page",
    rootId: "goal",
    format: "impact-map",
    root: "Grow repeat orders",
    measure: "Repeat rate",
    targetDate: "2027-06-30",
    productGoalId: "goal_1",
    now: AT,
  });
  m = withNode(m, { id: "actor", parentId: "goal", level: 1, text: "Busy parents" });
  m = withNode(m, { id: "impact", parentId: "actor", level: 2, text: "Skip a week" });
  m = withNode(m, { id: "deliv", parentId: "impact", level: 3, text: "Pause button" });
  m = withFocus(m, "impact");
  return withNodePatch(m, "deliv", {
    sentTo: [{ route: "backlog-story", targetId: "story_1", at: AT }],
  });
}

/** A Hoshin tree as the page builds it, with a question in the catchball. */
function pageTree(): StrategyMap {
  let t = newStrategyMap({
    id: "strategyMap_tree",
    rootId: "aim",
    format: "hoshin",
    root: "Half of orders from repeat customers",
    now: AT,
  });
  t = withNode(t, {
    id: "annual",
    parentId: "aim",
    level: 1,
    text: "A third by December",
    measure: "Repeat share",
    status: "proposed",
  });
  return withStatus(t, "annual", "questioned", "Is a third enough?");
}

const crudAccepts = (entity: StrategyMap) => {
  const parsed = registry.get("workspace.strategy_map.create")!.paramsSchema.safeParse({ entity });
  expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
};

beforeEach(() => {
  useWorkspaceStore.setState({ strategyMaps: [] });
});

describe("one collection for both tools", () => {
  it("reads the base's fixtures as they are", () => {
    expect(readStrategyMap(IMPACT_MAP)).toEqual(IMPACT_MAP);
    expect(readStrategyMap(STRATEGY_TREE)).toEqual(STRATEGY_TREE);
  });

  it("holds the Impact Map's example beside the Strategy Tree's three, each tool clearing its own", () => {
    const examples = [impactExample(NOW), ...treeExamples(NOW)];
    for (const m of examples) ws().upsertStrategyMap(m);
    ws().upsertStrategyMap(pageMap());
    expect(new Set(maps().map((m) => m.id)).size).toBe(5);
    for (const m of examples) {
      expect(strategyMapProblems(m, undefined), m.id).toEqual([]);
      expect(
        m.nodes.every((n) => isExampleId(n.id)),
        m.id
      ).toBe(true);
    }
    // The Strategy Tree's "Clear example" removes its own three only.
    for (const m of maps())
      if (isExampleId(m.id) && isTreeFormat(m.format)) {
        ws().removeStrategyMap(m.id);
      }
    expect(
      maps()
        .map((m) => m.format)
        .sort()
    ).toEqual(["impact-map", "impact-map"]);
  });
});

describe("what the pages write", () => {
  it("rides export and import unchanged, and reads back as written", () => {
    ws().upsertStrategyMap(pageMap());
    ws().upsertStrategyMap(pageTree());
    const json = ws().exportJSON();
    ws().resetWorkspace();
    expect(maps()).toEqual([]);
    ws().importJSON(json);
    expect(maps()).toEqual([pageMap(), pageTree()]);
    expect(readStrategyMaps(maps())).toEqual([pageMap(), pageTree()]);
  });

  it("keeps the rules and validates through the CRUD, examples included", () => {
    for (const m of [pageMap(), pageTree(), impactExample(NOW), ...treeExamples(NOW)]) {
      expect(strategyMapProblems(m, undefined), m.id).toEqual([]);
      crudAccepts(m);
    }
  });

  it("is updated by an agent without losing a field the page set", async () => {
    ws().upsertStrategyMap(pageMap());
    await registry
      .get("workspace.strategy_map.update")!
      .handler(
        { id: "strategyMap_page", patch: { title: "Repeat orders" } },
        { userId: "u", source: "agent", squadProfileIds: [] }
      );
    const after = maps()[0];
    expect(after.title).toBe("Repeat orders");
    expect(after.nodes).toEqual(pageMap().nodes);
    expect(after.productGoalId).toBe("goal_1");
  });

  it("refuses an agent's change of a map's format", async () => {
    ws().upsertStrategyMap(pageTree());
    await expect(
      Promise.resolve(
        registry
          .get("workspace.strategy_map.update")!
          .handler(
            { id: "strategyMap_tree", patch: { format: "dibb" } },
            { userId: "u", source: "agent", squadProfileIds: [] }
          )
      )
    ).rejects.toThrow(/Make a new map instead/);
    expect(maps()[0].format).toBe("hoshin");
  });
});

describe("a row that breaks the rules", () => {
  it("stays as stored, and reads into one that keeps them", () => {
    const synced = {
      ...pageMap(),
      nodes: [
        ...pageMap().nodes,
        { id: "stray", parentId: "gone", level: 3, text: "Lost deliverable", status: "agreed" },
        { id: "second-root", parentId: null, level: 0, text: "Another goal" },
      ],
    } as StrategyMap;
    useWorkspaceStore.setState({ strategyMaps: [synced] });
    expect(maps()[0]).toBe(synced);
    expect(strategyMapProblems(synced, undefined).length).toBeGreaterThan(0);
    const [read] = readStrategyMaps(maps());
    expect(strategyMapProblems(read, undefined)).toEqual([]);
    expect(read.nodes.find((n) => n.id === "stray")).toEqual({
      id: "stray",
      parentId: "goal",
      level: 1,
      text: "Lost deliverable",
    });
    expect(read.nodes.find((n) => n.id === "second-root")).toMatchObject({
      parentId: "goal",
      level: 1,
    });
  });
});
