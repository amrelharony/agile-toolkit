import { describe, it, expect } from "vitest";
import {
  layoutMindMap,
  isMindMapDescendant,
  MIND_MAP_NODE_DEFAULT,
} from "@/lib/whiteboard/mind-map-layout";
import type { WhiteboardMindMapNode } from "@/lib/stores/workspace-types";

/**
 * Characterization tests for the mind-map RT tree layout + the cycle-guard
 * descendant check. Previously untested.
 */

let seq = 0;
function node(
  id: string,
  parentNodeId: string | undefined,
  extra: Partial<WhiteboardMindMapNode> = {}
): WhiteboardMindMapNode {
  seq += 1;
  return {
    id,
    boardId: "b",
    type: "mindMapNode",
    x: 0,
    y: 0,
    w: 180,
    h: 56,
    z: 1,
    version: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdAt: `2026-01-01T00:00:0${seq}.000Z`,
    text: id,
    mindMapId: "m",
    parentNodeId,
    ...extra,
  };
}

describe("layoutMindMap", () => {
  it("returns an empty map when there is no root", () => {
    // All nodes have a parent → no root → empty.
    expect(layoutMindMap([node("a", "x")], { x: 0, y: 0 }).size).toBe(0);
  });

  it("places the root exactly at the supplied anchor", () => {
    const out = layoutMindMap([node("r", undefined)], { x: 120, y: 80 });
    expect(out.get("r")).toEqual({ x: 120, y: 80 });
  });

  it("falls back to the root's own position when no anchor is given", () => {
    const out = layoutMindMap([node("r", undefined, { x: 7, y: 9 })], null);
    expect(out.get("r")).toEqual({ x: 7, y: 9 });
  });

  it("radiates children to the right of the parent, stacked vertically", () => {
    const out = layoutMindMap([node("r", undefined), node("c1", "r"), node("c2", "r")], {
      x: 0,
      y: 0,
    });
    expect(out.get("r")).toEqual({ x: 0, y: 0 });
    // children x = rootX + rootW(180) + COL_GAP(64) = 244
    expect(out.get("c1")!.x).toBe(244);
    expect(out.get("c2")!.x).toBe(244);
    // stacked in createdAt order, c1 above c2
    expect(out.get("c1")!.y).toBeLessThan(out.get("c2")!.y);
  });

  it("skips a collapsed subtree (children not placed)", () => {
    const out = layoutMindMap([node("r", undefined, { collapsed: true }), node("c1", "r")], {
      x: 0,
      y: 0,
    });
    expect(out.has("r")).toBe(true);
    expect(out.has("c1")).toBe(false);
    expect(out.size).toBe(1);
  });

  it("exposes the default node size", () => {
    expect(MIND_MAP_NODE_DEFAULT).toEqual({ w: 180, h: 56 });
  });
});

describe("isMindMapDescendant", () => {
  const nodes = [
    node("r", undefined),
    node("c1", "r"),
    node("c2", "r"),
    node("g1", "c1"), // grandchild
    node("solo", undefined), // unrelated root
  ];

  it("treats a node as its own descendant (self-reparent guard)", () => {
    expect(isMindMapDescendant("r", "r", nodes)).toBe(true);
  });
  it("detects direct children and grandchildren", () => {
    expect(isMindMapDescendant("r", "c1", nodes)).toBe(true);
    expect(isMindMapDescendant("r", "g1", nodes)).toBe(true);
    expect(isMindMapDescendant("c1", "g1", nodes)).toBe(true);
  });
  it("returns false for unrelated / ancestor-of nodes", () => {
    expect(isMindMapDescendant("c1", "c2", nodes)).toBe(false);
    expect(isMindMapDescendant("g1", "r", nodes)).toBe(false);
    expect(isMindMapDescendant("r", "solo", nodes)).toBe(false);
  });
});
