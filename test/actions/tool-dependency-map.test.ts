/**
 * tool.dependency_map.* coverage.
 *
 *   1. list_state (read) + add_node / add_edge (write, mcpHandler, no confirm)
 *   2. list_state: counts, edge-kind breakdown, blocking-cycle detection
 *   3. add_node creates the map; add_edge rejects unknown endpoints, self-edges,
 *      and duplicates
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { DependencyMap } from "@/lib/stores/workspace-types";

import "@/lib/actions/tools/dependency-map";

const DM_ID = "dependency-map:current";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

function map(partial: Partial<DependencyMap> = {}): DependencyMap {
  return { id: DM_ID, nodes: [], edges: [], ...partial };
}

describe("tool.dependency_map — registration", () => {
  it("list_state read; add_node/add_edge write + mcpHandler + no confirm", () => {
    expect(registry.get("tool.dependency_map.list_state")?.category).toBe("read");
    for (const id of ["tool.dependency_map.add_node", "tool.dependency_map.add_edge"]) {
      expect(registry.get(id)?.category).toBe("write");
      expect(registry.get(id)?.mcpHandler).toBeTypeOf("function");
      expect(registry.get(id)?.requiresConfirmation).toBe(false);
    }
  });
});

describe("tool.dependency_map.list_state", () => {
  beforeEach(() => useWorkspaceStore.setState({ dependencyMaps: [] }));

  it("reports exists:false with no map", async () => {
    const r = (await registry.get("tool.dependency_map.list_state")!.handler({}, ctx())) as {
      exists: boolean;
      hasCycle: boolean;
    };
    expect(r.exists).toBe(false);
    expect(r.hasCycle).toBe(false);
  });

  it("counts nodes/edges by kind and detects a blocking cycle", async () => {
    useWorkspaceStore.getState().upsertDependencyMap(
      map({
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        edges: [
          { id: "e1", from: "a", to: "b", kind: "blocks" },
          // "A needs B": B delivers first, so B → A. With "A blocks B" (A → B)
          // that is a circular wait, read in delivery order as the page does.
          { id: "e2", from: "a", to: "b", kind: "needs" }, // a→b→a cycle
          { id: "e3", from: "a", to: "b", kind: "informs" },
        ],
      })
    );
    const r = (await registry.get("tool.dependency_map.list_state")!.handler({}, ctx())) as {
      nodeCount: number;
      edgeCount: number;
      byKind: { blocks: number; needs: number; informs: number };
      hasCycle: boolean;
    };
    expect(r.nodeCount).toBe(2);
    expect(r.edgeCount).toBe(3);
    expect(r.byKind).toEqual({ blocks: 1, needs: 1, informs: 1 });
    expect(r.hasCycle).toBe(true);
  });

  it("reads 'needs' in delivery order: 'A blocks B' and 'B needs A' are one direction, not a cycle", async () => {
    useWorkspaceStore.getState().upsertDependencyMap(
      map({
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        edges: [
          { id: "e1", from: "a", to: "b", kind: "blocks" },
          { id: "e2", from: "b", to: "a", kind: "needs" },
        ],
      })
    );
    const r = (await registry.get("tool.dependency_map.list_state")!.handler({}, ctx())) as {
      hasCycle: boolean;
    };
    expect(r.hasCycle).toBe(false);
  });

  it("ignores resolved, self and dangling edges, as the page does", async () => {
    useWorkspaceStore.getState().upsertDependencyMap(
      map({
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        edges: [
          { id: "e1", from: "a", to: "b", kind: "blocks" },
          { id: "e2", from: "b", to: "a", kind: "blocks", status: "resolved" },
          { id: "e3", from: "a", to: "a", kind: "blocks" },
          { id: "e4", from: "a", to: "gone", kind: "needs" },
        ],
      })
    );
    const r = (await registry.get("tool.dependency_map.list_state")!.handler({}, ctx())) as {
      hasCycle: boolean;
      edgeCount: number;
    };
    expect(r).toMatchObject({ hasCycle: false, edgeCount: 2 });
  });

  it("reports no cycle for an acyclic blocking graph", async () => {
    useWorkspaceStore.getState().upsertDependencyMap(
      map({
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        edges: [{ id: "e1", from: "a", to: "b", kind: "blocks" }],
      })
    );
    const r = (await registry.get("tool.dependency_map.list_state")!.handler({}, ctx())) as {
      hasCycle: boolean;
    };
    expect(r.hasCycle).toBe(false);
  });
});

describe("tool.dependency_map add_node / add_edge", () => {
  beforeEach(() => useWorkspaceStore.setState({ dependencyMaps: [] }));

  it("add_node creates the map and add_edge links existing nodes", async () => {
    const addNode = registry.get("tool.dependency_map.add_node")!;
    const a = (await addNode.handler({ label: "A" }, ctx())) as { id: string };
    const b = (await addNode.handler({ label: "B" }, ctx())) as { id: string };

    const addEdge = registry.get("tool.dependency_map.add_edge")!;
    const ok = (await addEdge.handler({ from: a.id, to: b.id, kind: "blocks" }, ctx())) as {
      added: boolean;
    };
    expect(ok.added).toBe(true);

    // duplicate → not added
    const dup = (await addEdge.handler({ from: a.id, to: b.id, kind: "blocks" }, ctx())) as {
      added: boolean;
    };
    expect(dup.added).toBe(false);

    // unknown endpoint → not added
    const bad = (await addEdge.handler({ from: a.id, to: "nope", kind: "needs" }, ctx())) as {
      added: boolean;
    };
    expect(bad.added).toBe(false);
  });
});
