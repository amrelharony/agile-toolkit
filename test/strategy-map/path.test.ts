/**
 * pathOf and sourcePath: the root-to-node path of a strategy map, and the
 * map and path an item sent from Impact Map or Strategy Tree points back to.
 */

import { describe, expect, it } from "vitest";
import { pathOf, sourcePath } from "@/lib/strategy-map/path";
import type { StrategyMap, StrategyMapNode } from "@/lib/stores/workspace-types";
import { IMPACT_MAP, STRATEGY_TREE } from "../stores/phase43-fixtures";

const nodeOf = (map: StrategyMap, id: string) => map.nodes.find((n) => n.id === id)!;
const ids = (path: StrategyMapNode[]) => path.map((n) => n.id);

describe("pathOf", () => {
  it("runs from the root to the node", () => {
    expect(ids(pathOf(IMPACT_MAP, nodeOf(IMPACT_MAP, "d1")))).toEqual(["g", "a1", "i1", "d1"]);
    expect(ids(pathOf(IMPACT_MAP, nodeOf(IMPACT_MAP, "g")))).toEqual(["g"]);
  });

  it("stops at a parent that isn't on the map", () => {
    const map: StrategyMap = {
      ...IMPACT_MAP,
      nodes: [
        { id: "a", parentId: "gone", level: 1, text: "a" },
        { id: "b", parentId: "a", level: 2, text: "b" },
      ],
    };
    expect(ids(pathOf(map, nodeOf(map, "b")))).toEqual(["a", "b"]);
  });

  it("stops on a loop instead of running forever", () => {
    const map: StrategyMap = {
      ...STRATEGY_TREE,
      nodes: [
        { id: "a", parentId: "b", level: 1, text: "a" },
        { id: "b", parentId: "a", level: 2, text: "b" },
        { id: "c", parentId: "c", level: 3, text: "c" },
      ],
    };
    expect(ids(pathOf(map, nodeOf(map, "b")))).toEqual(["a", "b"]);
    expect(ids(pathOf(map, nodeOf(map, "c")))).toEqual(["c"]);
  });
});

describe("sourcePath", () => {
  const maps = [IMPACT_MAP, STRATEGY_TREE];

  it("finds the map and path an impact map's or strategy tree's item came from", () => {
    const fromMap = sourcePath(maps, { tool: "impact-map", id: "d1", doc: IMPACT_MAP.id });
    expect(fromMap?.map).toBe(IMPACT_MAP);
    expect(ids(fromMap!.path)).toEqual(["g", "a1", "i1", "d1"]);
    const fromTree = sourcePath(maps, { tool: "strategy-tree", id: "init", doc: STRATEGY_TREE.id });
    expect(fromTree?.map).toBe(STRATEGY_TREE);
    expect(ids(fromTree!.path)).toEqual(["v", "goal", "bet", "init"]);
  });

  it("is null for another tool, no doc, a map that's gone or a node that's gone", () => {
    expect(sourcePath(maps, undefined)).toBeNull();
    expect(sourcePath(maps, { tool: "retro", id: "d1", doc: IMPACT_MAP.id })).toBeNull();
    expect(sourcePath(maps, { tool: "impact-map", id: "d1" })).toBeNull();
    expect(sourcePath(maps, { tool: "impact-map", id: "d1", doc: "strategyMap_gone" })).toBeNull();
    expect(sourcePath(maps, { tool: "impact-map", id: "gone", doc: IMPACT_MAP.id })).toBeNull();
  });
});
