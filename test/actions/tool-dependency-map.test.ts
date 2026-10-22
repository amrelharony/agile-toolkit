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
          { id: "e1", from: "a", to: "b", kind: "blocks" }, // a before b
          { id: "e2", from: "a", to: "b", kind: "needs" }, // b before a → cycle
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

  // Bug: list_state read every edge as from→to, but the board reads "A needs
  // B" as B before A. "A blocks B" + "B needs A" (the same fact said twice)
  // was reported as a cycle the board doesn't show.
  it("reads 'needs' in the board's direction: 'a blocks b' + 'b needs a' is no cycle", async () => {
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

  it("detects a cycle made only of 'needs' edges", async () => {
    useWorkspaceStore.getState().upsertDependencyMap(
      map({
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
          { id: "c", label: "C" },
        ],
        edges: [
          { id: "e1", from: "a", to: "b", kind: "needs" },
          { id: "e2", from: "b", to: "c", kind: "needs" },
          { id: "e3", from: "c", to: "a", kind: "needs" },
        ],
      })
    );
    const r = (await registry.get("tool.dependency_map.list_state")!.handler({}, ctx())) as {
      hasCycle: boolean;
    };
    expect(r.hasCycle).toBe(true);
  });

  // The board strips self-edges before cycle detection (they can't be created
  // in the UI, but a stored one must not read as an "A → A" cycle).
  it("ignores a stored self-edge, like the board does", async () => {
    useWorkspaceStore.getState().upsertDependencyMap(
      map({
        nodes: [{ id: "a", label: "A" }],
        edges: [{ id: "e1", from: "a", to: "a", kind: "blocks" }],
      })
    );
    const r = (await registry.get("tool.dependency_map.list_state")!.handler({}, ctx())) as {
      edgeCount: number;
      hasCycle: boolean;
    };
    expect(r.edgeCount).toBe(1);
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

  it("add_node keeps the team / description; add_edge refuses self-edges and a missing map", async () => {
    const addEdge = registry.get("tool.dependency_map.add_edge")!;
    const none = (await addEdge.handler({ from: "a", to: "b", kind: "blocks" }, ctx())) as {
      added: boolean;
    };
    expect(none.added).toBe(false);

    const a = (await registry
      .get("tool.dependency_map.add_node")!
      .handler({ label: "Checkout", team: "Payments", description: "PSP" }, ctx())) as {
      added: boolean;
      id: string;
    };
    expect(a.added).toBe(true);
    const stored = useWorkspaceStore.getState().dependencyMaps?.[0];
    expect(stored?.id).toBe(DM_ID);
    expect(stored?.nodes[0]).toMatchObject({
      id: a.id,
      label: "Checkout",
      team: "Payments",
      description: "PSP",
    });

    const self = (await addEdge.handler({ from: a.id, to: a.id, kind: "blocks" }, ctx())) as {
      added: boolean;
    };
    expect(self.added).toBe(false);
    expect(useWorkspaceStore.getState().dependencyMaps?.[0].edges).toEqual([]);
  });
});
