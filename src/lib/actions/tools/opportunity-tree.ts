/**
 * Opportunity Solution Tree — tool-local actions.
 *
 * Category: Product Discovery (squad S5)
 * Tool:     Outcome → opportunities → solutions → experiments (Teresa Torres).
 *
 * Agent surface: tool.opportunity_tree.*
 * Backing CRUD : workspace.opportunity_tree.* (auto-generated). Singleton: one
 *                OpportunityTree document (nodes[]) under a fixed id.
 *
 *   1. list_state  — node count + byKind breakdown.
 *   2. add_node    — add a node; refuses an unknown parentId (orphans).
 *
 * Entity kind "workspace:opportunityTree" + the fixed OT_ID match
 * opportunity-tree-client.tsx, so MCP writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type { OpportunityTree, TreeNode, TreeNodeKind } from "@/lib/stores/workspace-types";

const KIND_OT = "workspace:opportunityTree";
// MUST match OT_ID in opportunity-tree-client.tsx.
const OT_ID = "opportunityTree:current";

const KINDS = ["outcome", "opportunity", "solution", "experiment"] as const;
const KindSchema = z.enum(KINDS);

const ws = () => useWorkspaceStore.getState();

function emptyDoc(): OpportunityTree {
  return { id: OT_ID, nodes: [] };
}

function browserDoc(): OpportunityTree | null {
  return (ws().opportunityTrees ?? []).find((d) => d.id === OT_ID) ?? null;
}

function summarize(doc: OpportunityTree | null) {
  const nodes = doc?.nodes ?? [];
  const byKind: Record<TreeNodeKind, number> = {
    outcome: 0,
    opportunity: 0,
    solution: 0,
    experiment: 0,
  };
  for (const n of nodes) if (n.kind in byKind) byKind[n.kind] += 1;
  return { exists: doc !== null, total: nodes.length, byKind, nodes };
}

// ──────── tool.opportunity_tree.list_state ────────
registry.register({
  id: "tool.opportunity_tree.list_state",
  toolId: "tool.opportunity_tree",
  name: "list_state",
  category: "read",
  description:
    "Summarise the opportunity solution tree. Returns {exists, total, byKind: {outcome, opportunity, solution, experiment}, nodes: {id, kind, text, parentId}[]}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserDoc()),
  mcpHandler: async (_params, ctx) => {
    const doc = await serverGetEntity<OpportunityTree>(ctx.userId, KIND_OT, OT_ID);
    return summarize(doc ?? null);
  },
});

// ──────── tool.opportunity_tree.add_node ────────
// kind is outcome | opportunity | solution | experiment. parentId null/omitted
// = a root (typically the outcome). A non-null parentId must reference an
// existing node — orphan nodes can't render in the tree. Additive → no confirm.
registry.register({
  id: "tool.opportunity_tree.add_node",
  toolId: "tool.opportunity_tree",
  name: "add_node",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a node to the tree. kind is outcome|opportunity|solution|experiment. parentId omitted/null = root; a non-null parentId must reference an existing node. Returns {added: false} when parentId is unknown, else {added: true, id}.",
  paramsSchema: z.object({
    kind: KindSchema,
    text: z.string().min(1).max(2000),
    parentId: z.string().nullable().optional(),
    evidence: z.string().max(2000).optional(),
    description: z.string().max(2000).optional(),
  }),
  handler: async (params) => {
    const base = browserDoc() ?? emptyDoc();
    const node = buildNode(base, params);
    if (!node) return { added: false };
    ws().upsertOpportunityTree({ ...base, id: OT_ID, nodes: [...base.nodes, node] });
    return { added: true, id: node.id };
  },
  mcpHandler: async (params, ctx) => {
    const base = (await serverGetEntity<OpportunityTree>(ctx.userId, KIND_OT, OT_ID)) ?? emptyDoc();
    const node = buildNode(base, params);
    if (!node) return { added: false };
    await serverUpsertEntity<OpportunityTree>(ctx.userId, KIND_OT, {
      ...base,
      id: OT_ID,
      nodes: [...base.nodes, node],
    });
    return { added: true, id: node.id };
  },
});

/** Build a node, or null when a non-null parentId references nothing. */
function buildNode(
  doc: OpportunityTree,
  params: {
    kind: TreeNodeKind;
    text: string;
    parentId?: string | null;
    evidence?: string;
    description?: string;
  }
): TreeNode | null {
  const parentId = params.parentId ?? null;
  if (parentId !== null && !doc.nodes.some((n) => n.id === parentId)) return null;
  return {
    id: crypto.randomUUID(),
    kind: params.kind,
    text: params.text,
    parentId,
    evidence: params.evidence,
    description: params.description,
  };
}
