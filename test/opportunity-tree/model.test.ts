/**
 * lib/opportunity-tree/model: which kind may go where, removing a subtree
 * or a single node, one target per outcome, and what an experiment and a
 * quote hand over. JTBD's readers are re-exported unchanged.
 */

import { describe, expect, it } from "vitest";
import type { TreeNode } from "@/lib/stores/workspace-types";
import {
  CHILD_KINDS,
  NODE_KINDS,
  NODE_TEXT_MAX,
  OPPORTUNITY_TREE_ID,
  ROOT_KINDS,
  canParent,
  experimentHypothesisSource,
  opportunityFromSource,
  opportunityGroups,
  outcomeOf,
  subtreeIds,
  targetClashes,
  treeNodes,
  withTarget,
  withoutNode,
  withoutSubtree,
} from "@/lib/opportunity-tree/model";
import * as jtbd from "@/app/(tools)/jtbd-mapper/opportunities";

const node = (
  id: string,
  kind: TreeNode["kind"],
  parentId: string | null,
  over: Partial<TreeNode> = {}
): TreeNode => ({ id, kind, text: `${kind} ${id}`, parentId, ...over });

/**
 *   o1 outcome
 *     p1 opportunity (target)
 *       p2 opportunity
 *         s1 solution
 *           e1 experiment
 *     p3 opportunity
 *   o2 outcome
 *     p4 opportunity (target)
 *   r1 opportunity (root, target)
 *   r2 opportunity (root)
 */
const TREE: TreeNode[] = [
  node("o1", "outcome", null),
  node("p1", "opportunity", "o1", { target: true }),
  node("p2", "opportunity", "p1"),
  node("s1", "solution", "p2"),
  node("e1", "experiment", "s1", { description: "Two weeks" }),
  node("p3", "opportunity", "o1"),
  node("o2", "outcome", null),
  node("p4", "opportunity", "o2", { target: true }),
  node("r1", "opportunity", null, { target: true }),
  node("r2", "opportunity", null),
];

describe("kinds", () => {
  it("lets an opportunity hold smaller opportunities and solutions, an experiment nothing", () => {
    expect(NODE_KINDS).toEqual(["outcome", "opportunity", "solution", "experiment"]);
    expect(CHILD_KINDS.opportunity).toEqual(["opportunity", "solution"]);
    expect(CHILD_KINDS.experiment).toEqual([]);
    expect(ROOT_KINDS).toEqual(["outcome", "opportunity"]);
  });

  it("checks a kind against its parent, or the root", () => {
    const [o1, p1, , s1, e1] = TREE;
    expect(canParent(null, "outcome")).toBe(true);
    expect(canParent(undefined, "opportunity")).toBe(true);
    expect(canParent(null, "solution")).toBe(false);
    expect(canParent(null, "experiment")).toBe(false);
    expect(canParent(o1, "opportunity")).toBe(true);
    expect(canParent(o1, "solution")).toBe(false);
    expect(canParent(p1, "opportunity")).toBe(true);
    expect(canParent(p1, "solution")).toBe(true);
    expect(canParent(s1, "experiment")).toBe(true);
    expect(canParent(e1, "outcome")).toBe(false);
    expect(canParent({ ...o1, kind: "bogus" as TreeNode["kind"] }, "opportunity")).toBe(false);
  });
});

describe("removing", () => {
  it("finds a subtree, also when parent links form a cycle", () => {
    expect(Array.from(subtreeIds(TREE, "p1")).sort()).toEqual(["e1", "p1", "p2", "s1"]);
    expect(subtreeIds(TREE, "nope").size).toBe(0);
    const cycle = [
      node("a", "opportunity", "b"),
      node("b", "opportunity", "a"),
      node("c", "solution", "b"),
    ];
    expect(Array.from(subtreeIds(cycle, "a")).sort()).toEqual(["a", "b", "c"]);
  });

  it("removes a node and everything under it", () => {
    expect(withoutSubtree(TREE, "p1").map((n) => n.id)).toEqual([
      "o1",
      "p3",
      "o2",
      "p4",
      "r1",
      "r2",
    ]);
    expect(withoutSubtree(TREE, "nope")).toEqual(TREE);
  });

  it("removes a node alone, moving its children up to its parent", () => {
    const next = withoutNode(TREE, "p2");
    expect(next.find((n) => n.id === "p2")).toBeUndefined();
    expect(next.find((n) => n.id === "s1")?.parentId).toBe("p1");
    expect(next.find((n) => n.id === "e1")?.parentId).toBe("s1");
    // A root node's children go to the root.
    expect(withoutNode(TREE, "o2").find((n) => n.id === "p4")?.parentId).toBeNull();
    expect(withoutNode(TREE, "nope")).toEqual(TREE);
  });
});

describe("withTarget", () => {
  const targets = (nodes: TreeNode[]) => nodes.filter((n) => n.target).map((n) => n.id);

  it("marks one opportunity per outcome, clearing the outcome's other target", () => {
    expect(targets(withTarget(TREE, "p3", true))).toEqual(["p3", "p4", "r1"]);
    // A nested opportunity serves the same outcome.
    expect(targets(withTarget(TREE, "p2", true))).toEqual(["p2", "p4", "r1"]);
  });

  it("treats the opportunities under no outcome as one group", () => {
    expect(targets(withTarget(TREE, "r2", true))).toEqual(["p1", "p4", "r2"]);
  });

  it("unmarks without touching the others, and leaves no empty key", () => {
    const next = withTarget(TREE, "p1", false);
    expect(targets(next)).toEqual(["p4", "r1"]);
    expect(next.find((n) => n.id === "p1")).not.toHaveProperty("target");
  });

  it("leaves anything but an opportunity alone", () => {
    expect(withTarget(TREE, "s1", true)).toEqual(TREE);
    expect(withTarget(TREE, "nope", true)).toEqual(TREE);
  });
});

describe("targetClashes", () => {
  it("finds no clash in a tree with one target per outcome, nor in what withTarget leaves", () => {
    expect(targetClashes(TREE)).toEqual([]);
    expect(targetClashes(withTarget(TREE, "p2", true))).toEqual([]);
    expect(targetClashes(withTarget(TREE, "r2", true))).toEqual([]);
  });

  it("names each outcome holding two or more, nested opportunities and moves included", () => {
    const twice = TREE.map((n) => (n.id === "p2" ? { ...n, target: true } : n));
    expect(targetClashes(twice)).toEqual([{ outcomeId: "o1", ids: ["p1", "p2"] }]);
    // p4, o2's target, moved under o1: o1 now holds two.
    const moved = TREE.map((n) => (n.id === "p4" ? { ...n, parentId: "o1" } : n));
    expect(targetClashes(moved)).toEqual([{ outcomeId: "o1", ids: ["p1", "p4"] }]);
  });

  it("counts the opportunities under no outcome as one group", () => {
    const roots = TREE.map((n) => (n.id === "r2" ? { ...n, target: true } : n));
    expect(targetClashes(roots)).toEqual([{ outcomeId: null, ids: ["r1", "r2"] }]);
  });
});

describe("experimentHypothesisSource", () => {
  it("believes the solution, does the experiment, learns about the nearest opportunity", () => {
    const e1 = TREE.find((n) => n.id === "e1")!;
    expect(experimentHypothesisSource(e1, TREE)).toEqual({
      title: "solution s1",
      description: "opportunity p2",
      hypothesis: { willDo: "experiment e1", experiment: "Two weeks" },
      sourceRef: { tool: "opportunity-tree", id: "e1", doc: OPPORTUNITY_TREE_ID },
    });
  });

  it("falls back to the experiment's own text under no solution, and drops blanks", () => {
    const stray = node("e9", "experiment", null, { text: "We believe a nudge helps" });
    expect(experimentHypothesisSource(stray, [stray])).toEqual({
      title: "a nudge helps",
      hypothesis: { willDo: "We believe a nudge helps" },
      sourceRef: { tool: "opportunity-tree", id: "e9", doc: OPPORTUNITY_TREE_ID },
    });
    const blank = node("e8", "experiment", "s0", { text: "  " });
    const s0 = node("s0", "solution", null, { text: "" });
    expect(experimentHypothesisSource(blank, [s0, blank]).title).toBe("");
  });
});

describe("opportunityFromSource", () => {
  const src = (parentId?: string) => ({
    title: "  I export every Friday  ",
    description: "From an interview on 2026-10-14",
    ...(parentId ? { parentId } : {}),
    sourceRef: { tool: "user-interviews", id: "q1", doc: "int1" },
  });

  it("goes under an outcome or an opportunity, with the description as evidence", () => {
    expect(opportunityFromSource(src("o1"), TREE, "n1")).toEqual({
      id: "n1",
      kind: "opportunity",
      text: "I export every Friday",
      parentId: "o1",
      evidence: "From an interview on 2026-10-14",
      sourceRef: { tool: "user-interviews", id: "q1", doc: "int1" },
    });
    expect(opportunityFromSource(src("p2"), TREE, "n2").parentId).toBe("p2");
  });

  it("goes to the root with no parent, a missing one, or one that can't hold it", () => {
    expect(opportunityFromSource(src(), TREE, "n").parentId).toBeNull();
    expect(opportunityFromSource(src("gone"), TREE, "n").parentId).toBeNull();
    expect(opportunityFromSource(src("s1"), TREE, "n").parentId).toBeNull();
    expect(opportunityFromSource(src("e1"), TREE, "n").parentId).toBeNull();
  });

  it("caps the text and leaves out an empty evidence", () => {
    const n = opportunityFromSource(
      { title: "t".repeat(NODE_TEXT_MAX + 5), sourceRef: { tool: "x", id: "y" } },
      [],
      "n"
    );
    expect(n.text).toHaveLength(NODE_TEXT_MAX);
    expect(n).not.toHaveProperty("evidence");
  });
});

describe("JTBD's readers", () => {
  it("are the tree model's, re-exported", () => {
    expect(jtbd.treeNodes).toBe(treeNodes);
    expect(jtbd.outcomeOf).toBe(outcomeOf);
    expect(jtbd.opportunityGroups).toBe(opportunityGroups);
    expect(jtbd.OPPORTUNITY_TREE_ID).toBe(OPPORTUNITY_TREE_ID);
  });

  it("group opportunities by outcome, nested ones included, root ones last", () => {
    const groups = opportunityGroups(TREE);
    expect(groups.map((g) => [g.outcomeId, g.options.map((o) => o.id)])).toEqual([
      ["o1", ["p1", "p2", "p3"]],
      ["o2", ["p4"]],
      [null, ["r1", "r2"]],
    ]);
    expect(treeNodes([{ id: OPPORTUNITY_TREE_ID, nodes: TREE }])).toBe(TREE);
    expect(treeNodes(undefined)).toEqual([]);
  });
});
