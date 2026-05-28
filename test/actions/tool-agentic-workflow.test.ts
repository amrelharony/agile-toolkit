/**
 * tool.agentic_workflow.* coverage (two-collection join).
 *
 *   1. registration — list_state/get_workflow read; create_workflow/add_node
 *      write + mcpHandler + no confirm.
 *   2. list_state — joins nodes onto workflows (nodeCount, nodesByKind).
 *   3. get_workflow — returns {workflow, nodes} or null.
 *   4. create_workflow — appends a workflow.
 *   5. add_node — adds to an existing workflow; refuses orphan ({added:false}).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { AgentWorkflow, AgentNode } from "@/lib/stores/workspace-types";

import "@/lib/actions/tools/agentic-workflow";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

function node(
  p: Partial<AgentNode> & Pick<AgentNode, "id" | "workflowId" | "label" | "kind">
): AgentNode {
  return { ...p };
}

describe("tool.agentic_workflow — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.agentic_workflow.list_state")?.category).toBe("read");
    expect(registry.get("tool.agentic_workflow.get_workflow")?.category).toBe("read");
    expect(registry.get("tool.agentic_workflow.create_workflow")?.category).toBe("write");
    expect(registry.get("tool.agentic_workflow.create_workflow")?.mcpHandler).toBeTypeOf(
      "function"
    );
    expect(registry.get("tool.agentic_workflow.create_workflow")?.requiresConfirmation).toBe(false);
    expect(registry.get("tool.agentic_workflow.add_node")?.requiresConfirmation).toBe(false);
  });
});

describe("tool.agentic_workflow.list_state", () => {
  beforeEach(() => useWorkspaceStore.setState({ agentWorkflows: [], agentNodes: [] }));

  it("is empty when no workflows", async () => {
    const r = (await registry.get("tool.agentic_workflow.list_state")!.handler({}, ctx())) as {
      totalWorkflows: number;
      totalNodes: number;
      workflows: unknown[];
    };
    expect(r.totalWorkflows).toBe(0);
    expect(r.totalNodes).toBe(0);
    expect(r.workflows).toEqual([]);
  });

  it("joins nodes onto their workflow with per-kind tallies", async () => {
    useWorkspaceStore.setState({
      agentWorkflows: [
        { id: "w1", name: "RAG pipeline" },
        { id: "w2", name: "empty" },
      ] as AgentWorkflow[],
      agentNodes: [
        node({ id: "n1", workflowId: "w1", label: "retrieve", kind: "tool" }),
        node({ id: "n2", workflowId: "w1", label: "answer", kind: "agent" }),
        node({ id: "n3", workflowId: "w1", label: "review", kind: "human" }),
        // orphan node pointing at a non-existent workflow — counted in
        // totalNodes but not joined to any listed workflow.
        node({ id: "n4", workflowId: "ghost", label: "dangling", kind: "agent" }),
      ],
    });

    const r = (await registry.get("tool.agentic_workflow.list_state")!.handler({}, ctx())) as {
      totalWorkflows: number;
      totalNodes: number;
      workflows: { id: string; nodeCount: number; nodesByKind: Record<string, number> }[];
    };
    expect(r.totalWorkflows).toBe(2);
    expect(r.totalNodes).toBe(4);
    const w1 = r.workflows.find((w) => w.id === "w1")!;
    expect(w1.nodeCount).toBe(3);
    expect(w1.nodesByKind).toEqual({ agent: 1, tool: 1, human: 1, fallback: 0, branch: 0 });
    expect(r.workflows.find((w) => w.id === "w2")!.nodeCount).toBe(0);
  });
});

describe("tool.agentic_workflow.get_workflow", () => {
  beforeEach(() =>
    useWorkspaceStore.setState({
      agentWorkflows: [{ id: "w1", name: "RAG" }] as AgentWorkflow[],
      agentNodes: [node({ id: "n1", workflowId: "w1", label: "retrieve", kind: "tool" })],
    })
  );

  it("returns the workflow joined to its nodes", async () => {
    const r = (await registry
      .get("tool.agentic_workflow.get_workflow")!
      .handler({ id: "w1" }, ctx())) as { workflow: AgentWorkflow; nodes: AgentNode[] };
    expect(r.workflow.name).toBe("RAG");
    expect(r.nodes).toHaveLength(1);
    expect(r.nodes[0].label).toBe("retrieve");
  });

  it("returns null for an unknown id", async () => {
    const r = await registry
      .get("tool.agentic_workflow.get_workflow")!
      .handler({ id: "nope" }, ctx());
    expect(r).toBeNull();
  });
});

describe("tool.agentic_workflow.create_workflow + add_node", () => {
  beforeEach(() => useWorkspaceStore.setState({ agentWorkflows: [], agentNodes: [] }));

  it("creates a workflow then adds a node to it", async () => {
    const created = (await registry
      .get("tool.agentic_workflow.create_workflow")!
      .handler({ name: "pipeline" }, ctx())) as { added: boolean; id: string };
    expect(created.added).toBe(true);

    const added = (await registry
      .get("tool.agentic_workflow.add_node")!
      .handler({ workflowId: created.id, label: "step 1", kind: "agent" }, ctx())) as {
      added: boolean;
      id: string;
    };
    expect(added.added).toBe(true);
    expect(useWorkspaceStore.getState().agentNodes ?? []).toHaveLength(1);
  });

  it("refuses to add a node to an unknown workflow (no orphans)", async () => {
    const added = (await registry
      .get("tool.agentic_workflow.add_node")!
      .handler({ workflowId: "ghost", label: "orphan", kind: "agent" }, ctx())) as {
      added: boolean;
    };
    expect(added.added).toBe(false);
    expect(useWorkspaceStore.getState().agentNodes ?? []).toHaveLength(0);
  });
});
