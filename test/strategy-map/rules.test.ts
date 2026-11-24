/**
 * strategyMapProblems: the rules every strategy map write keeps (one root,
 * each node one level below its parent, the impact map's own fields, a
 * format that never changes).
 */

import { describe, expect, it } from "vitest";
import { strategyMapProblems } from "@/lib/strategy-map/rules";
import type { StrategyMap, StrategyMapNode } from "@/lib/stores/workspace-types";
import { IMPACT_MAP, STRATEGY_TREE } from "../stores/phase43-fixtures";

const node = (
  id: string,
  parentId: string | null,
  level: 0 | 1 | 2 | 3,
  extra: Partial<StrategyMapNode> = {}
): StrategyMapNode => ({ id, parentId, level, text: id, ...extra });

const withNodes = (map: StrategyMap, nodes: StrategyMapNode[]): StrategyMap => ({ ...map, nodes });

describe("strategyMapProblems", () => {
  it("finds nothing wrong with a well-formed impact map or strategy tree", () => {
    expect(strategyMapProblems(IMPACT_MAP, undefined)).toEqual([]);
    expect(strategyMapProblems(STRATEGY_TREE, undefined)).toEqual([]);
    expect(strategyMapProblems(IMPACT_MAP, IMPACT_MAP)).toEqual([]);
  });

  it("takes an empty map", () => {
    expect(strategyMapProblems(withNodes(IMPACT_MAP, []), undefined)).toEqual([]);
  });

  it("refuses a format change on an update", () => {
    const problems = strategyMapProblems({ ...STRATEGY_TREE, format: "dibb" }, STRATEGY_TREE);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/lean-value-tree, not dibb\. Make a new map instead\./);
  });

  it("names repeated ids", () => {
    const problems = strategyMapProblems(
      withNodes(STRATEGY_TREE, [node("v", null, 0), node("a", "v", 1), node("a", "v", 1)]),
      undefined
    );
    expect(problems).toEqual(["Node ids repeat (a). Give each node its own id."]);
  });

  it("wants exactly one root at level 0", () => {
    expect(
      strategyMapProblems(
        withNodes(STRATEGY_TREE, [node("a", "b", 1), node("b", "a", 1)]),
        undefined
      )
    ).toContain("A map needs one root: a node at level 0 with parentId null. It has none.");
    const two = strategyMapProblems(
      withNodes(STRATEGY_TREE, [node("v", null, 0), node("w", null, 0)]),
      undefined
    );
    expect(two[0]).toMatch(/These are roots: v \(level 0\), w \(level 0\)\./);
    const high = strategyMapProblems(withNodes(STRATEGY_TREE, [node("v", null, 1)]), undefined);
    expect(high[0]).toMatch(/v \(level 1\)/);
  });

  it("wants each node's parent on the map, one level above it, and never at the last level", () => {
    const missing = strategyMapProblems(
      withNodes(STRATEGY_TREE, [node("v", null, 0), node("a", "gone", 1)]),
      undefined
    );
    expect(missing).toEqual([
      "Node a's parent gone isn't on the map. Point it at a node that is, or remove it.",
    ]);
    const skipped = strategyMapProblems(
      withNodes(STRATEGY_TREE, [node("v", null, 0), node("a", "v", 2)]),
      undefined
    );
    expect(skipped).toEqual([
      "Node a is at level 2, but its parent v is at level 0: a node sits one level below its parent.",
    ]);
    const under = strategyMapProblems(
      withNodes(STRATEGY_TREE, [
        node("v", null, 0),
        node("a", "v", 1),
        node("b", "a", 2),
        node("c", "b", 3),
        node("d", "c", 3),
      ]),
      undefined
    );
    expect(under).toEqual([
      "Node d sits under c, which is at level 3, the last level: nothing goes under it.",
    ]);
  });

  it("keeps personas on an impact map's actors only", () => {
    const onImpact = strategyMapProblems(
      withNodes(IMPACT_MAP, [
        node("g", null, 0),
        node("a", "g", 1, { personaId: "p" }),
        node("i", "a", 2, { personaId: "p" }),
      ]),
      undefined
    );
    expect(onImpact).toEqual([
      "Only an impact map's actors (level 1) link a persona: remove personaId from i.",
    ]);
    const onTree = strategyMapProblems(
      withNodes(STRATEGY_TREE, [node("v", null, 0), node("a", "v", 1, { personaId: "p" })]),
      undefined
    );
    expect(onTree[0]).toMatch(/remove personaId from a\./);
  });

  it("keeps the focus on one of an impact map's impacts", () => {
    const stray = strategyMapProblems(
      withNodes(IMPACT_MAP, [node("g", null, 0, { focus: true }), node("a", "g", 1)]),
      undefined
    );
    expect(stray).toEqual([
      "Only an impact map's impacts (level 2) can be its focus: remove focus from g.",
    ]);
    const two = strategyMapProblems(
      withNodes(IMPACT_MAP, [
        node("g", null, 0),
        node("a", "g", 1),
        node("i", "a", 2, { focus: true }),
        node("j", "a", 2, { focus: true }),
      ]),
      undefined
    );
    expect(two).toEqual(["An impact map has one focus impact, but i, j are all marked. Keep one."]);
    const unset = strategyMapProblems(
      withNodes(IMPACT_MAP, [node("g", null, 0, { focus: false })]),
      undefined
    );
    expect(unset).toEqual([]);
    const onTree = strategyMapProblems(
      withNodes(STRATEGY_TREE, [
        node("v", null, 0),
        node("a", "v", 1),
        node("i", "a", 2, { focus: true }),
      ]),
      undefined
    );
    expect(onTree[0]).toMatch(/remove focus from i\./);
  });

  it("keeps statuses and notes off an impact map", () => {
    const problems = strategyMapProblems(
      withNodes(IMPACT_MAP, [
        node("g", null, 0, { status: "agreed" }),
        node("a", "g", 1, { note: "n" }),
      ]),
      undefined
    );
    expect(problems).toEqual([
      "An impact map's nodes have no status or note (a strategy tree's): remove them from g, a.",
    ]);
  });

  it("lists every problem it finds", () => {
    const problems = strategyMapProblems(
      {
        ...withNodes(IMPACT_MAP, [node("g", null, 0, { note: "n" }), node("g", null, 2)]),
        format: "impact-map",
      },
      { ...IMPACT_MAP, format: "hoshin" }
    );
    expect(problems.length).toBeGreaterThanOrEqual(4);
  });
});
