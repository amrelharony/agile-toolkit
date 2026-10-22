/**
 * tool.opportunity_tree.* coverage (singleton doc, S5).
 *
 *   1. registration — list_state read; add_node write + mcpHandler.
 *   2. add_node — root (no parent) + child; refuses an unknown parentId.
 *   3. list_state — byKind breakdown.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

import "@/lib/actions/tools/opportunity-tree";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

describe("tool.opportunity_tree — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.opportunity_tree.list_state")?.category).toBe("read");
    expect(registry.get("tool.opportunity_tree.add_node")?.category).toBe("write");
    expect(registry.get("tool.opportunity_tree.add_node")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.opportunity_tree.add_node")?.requiresConfirmation).toBe(false);
  });
});

describe("tool.opportunity_tree.add_node + list_state", () => {
  beforeEach(() => useWorkspaceStore.setState({ opportunityTrees: [] }));

  it("adds a root + child and refuses an orphan", async () => {
    const root = (await registry
      .get("tool.opportunity_tree.add_node")!
      .handler({ kind: "outcome", text: "Increase activation" }, ctx())) as {
      added: boolean;
      id: string;
    };
    expect(root.added).toBe(true);

    const child = (await registry
      .get("tool.opportunity_tree.add_node")!
      .handler({ kind: "opportunity", text: "Setup is confusing", parentId: root.id }, ctx())) as {
      added: boolean;
    };
    expect(child.added).toBe(true);

    const orphan = (await registry
      .get("tool.opportunity_tree.add_node")!
      .handler({ kind: "solution", text: "x", parentId: "ghost" }, ctx())) as { added: boolean };
    expect(orphan.added).toBe(false);

    const r = (await registry.get("tool.opportunity_tree.list_state")!.handler({}, ctx())) as {
      total: number;
      byKind: Record<string, number>;
    };
    expect(r.total).toBe(2);
    expect(r.byKind.outcome).toBe(1);
    expect(r.byKind.opportunity).toBe(1);
  });
});

describe("tool.opportunity_tree.add_node details", () => {
  beforeEach(() => useWorkspaceStore.setState({ opportunityTrees: [] }));

  it("list_state on an empty workspace reports no tree", async () => {
    const r = (await registry.get("tool.opportunity_tree.list_state")!.handler({}, ctx())) as {
      exists: boolean;
      total: number;
    };
    expect(r).toMatchObject({ exists: false, total: 0 });
  });

  it("stores evidence + description and treats an explicit null parent as a root", async () => {
    const r = (await registry
      .get("tool.opportunity_tree.add_node")!
      .handler(
        { kind: "outcome", text: "Grow", parentId: null, evidence: "e", description: "d" },
        ctx()
      )) as { added: boolean; id: string };
    expect(r.added).toBe(true);
    expect((useWorkspaceStore.getState().opportunityTrees ?? [])[0].nodes).toEqual([
      { id: r.id, kind: "outcome", text: "Grow", parentId: null, evidence: "e", description: "d" },
    ]);
  });
});
