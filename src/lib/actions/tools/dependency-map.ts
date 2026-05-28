/**
 * Dependency Map — tool-local actions.
 *
 * Category: Flow & Delivery (squad S6)
 * Agent surface: tool.dependency_map.*
 * Backing CRUD : workspace.dependency_map.* (auto-generated). Singleton: one
 *                graph document under a fixed id.
 *
 *   1. list_state — node/edge counts, edge-kind breakdown, and whether the
 *      blocking graph (blocks/needs edges) contains a cycle.
 *   2. add_node   — add a node (team / workstream / deliverable).
 *   3. add_edge   — add a directed dependency between two existing nodes
 *      (idempotent; rejects unknown endpoints).
 *
 * Entity kind "workspace:dependencyMap" (camelCase via kindFromToolId)
 * matches the browser sync engine so MCP writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type { DependencyMap, DependencyNode, DependencyEdge } from "@/lib/stores/workspace-types";

const KIND_DEPMAP = "workspace:dependencyMap";
// MUST match DM_ID in dependency-map-client.tsx.
const DM_ID = "dependency-map:current";

const ws = () => useWorkspaceStore.getState();

function emptyMap(): DependencyMap {
  return { id: DM_ID, nodes: [], edges: [] };
}

function browserMap(): DependencyMap | null {
  return (ws().dependencyMaps ?? []).find((d) => d.id === DM_ID) ?? null;
}

/** Does the directed blocking graph (blocks/needs edges) contain a cycle?
 *  DFS with a recursion stack; a visited-set bounds work on shared subtrees. */
function hasCycle(nodes: DependencyNode[], edges: DependencyEdge[]): boolean {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (e.kind === "blocks" || e.kind === "needs") {
      const list = adj.get(e.from) ?? [];
      list.push(e.to);
      adj.set(e.from, list);
    }
  }
  const visited = new Set<string>();
  const stack = new Set<string>();
  const dfs = (id: string): boolean => {
    if (stack.has(id)) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    stack.add(id);
    for (const next of adj.get(id) ?? []) {
      if (dfs(next)) return true;
    }
    stack.delete(id);
    return false;
  };
  return nodes.some((n) => dfs(n.id));
}

function summarize(map: DependencyMap | null) {
  if (!map) {
    return {
      exists: false,
      nodeCount: 0,
      edgeCount: 0,
      byKind: { blocks: 0, needs: 0, informs: 0 },
      hasCycle: false,
    };
  }
  const byKind = { blocks: 0, needs: 0, informs: 0 };
  for (const e of map.edges) if (e.kind in byKind) byKind[e.kind] += 1;
  return {
    exists: true,
    nodeCount: map.nodes.length,
    edgeCount: map.edges.length,
    byKind,
    hasCycle: hasCycle(map.nodes, map.edges),
  };
}

// ──────── tool.dependency_map.list_state ────────
registry.register({
  id: "tool.dependency_map.list_state",
  toolId: "tool.dependency_map",
  name: "list_state",
  category: "read",
  description:
    "Summarise the dependency graph. Returns {exists, nodeCount, edgeCount, byKind: {blocks, needs, informs}, hasCycle (blocking cycle in blocks/needs edges)}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserMap()),
  mcpHandler: async (_params, ctx) => {
    const map = await serverGetEntity<DependencyMap>(ctx.userId, KIND_DEPMAP, DM_ID);
    return summarize(map ?? null);
  },
});

// ──────── tool.dependency_map.add_node ────────
registry.register({
  id: "tool.dependency_map.add_node",
  toolId: "tool.dependency_map",
  name: "add_node",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a node (team / workstream / deliverable) to the dependency map. Creates the map if absent. Returns {added: true, id}.",
  paramsSchema: z.object({
    label: z.string().min(1),
    team: z.string().optional(),
    description: z.string().optional(),
  }),
  handler: async (params) => {
    const map = browserMap() ?? emptyMap();
    const node: DependencyNode = { id: crypto.randomUUID(), ...params };
    ws().upsertDependencyMap({ ...map, nodes: [...map.nodes, node] });
    return { added: true, id: node.id };
  },
  mcpHandler: async (params, ctx) => {
    const map =
      (await serverGetEntity<DependencyMap>(ctx.userId, KIND_DEPMAP, DM_ID)) ?? emptyMap();
    const node: DependencyNode = { id: crypto.randomUUID(), ...params };
    await serverUpsertEntity<DependencyMap>(ctx.userId, KIND_DEPMAP, {
      ...map,
      nodes: [...map.nodes, node],
    });
    return { added: true, id: node.id };
  },
});

// ──────── tool.dependency_map.add_edge ────────
const EdgeKind = z.enum(["blocks", "needs", "informs"]);

function addEdge(
  map: DependencyMap,
  from: string,
  to: string,
  kind: DependencyEdge["kind"]
): { map: DependencyMap; added: boolean } {
  const ids = new Set(map.nodes.map((n) => n.id));
  if (!ids.has(from) || !ids.has(to) || from === to) return { map, added: false };
  // Idempotent: don't duplicate an identical (from,to,kind) edge.
  if (map.edges.some((e) => e.from === from && e.to === to && e.kind === kind)) {
    return { map, added: false };
  }
  const edge: DependencyEdge = { id: crypto.randomUUID(), from, to, kind };
  return { map: { ...map, edges: [...map.edges, edge] }, added: true };
}

registry.register({
  id: "tool.dependency_map.add_edge",
  toolId: "tool.dependency_map",
  name: "add_edge",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a directed dependency edge between two existing nodes. kind: blocks | needs | informs. Idempotent; returns {added: false} when an endpoint is unknown, it's a self-edge, or the edge already exists.",
  paramsSchema: z.object({ from: z.string(), to: z.string(), kind: EdgeKind }),
  handler: async (params) => {
    const map = browserMap();
    if (!map) return { added: false };
    const { map: next, added } = addEdge(map, params.from, params.to, params.kind);
    if (added) ws().upsertDependencyMap(next);
    return { added };
  },
  mcpHandler: async (params, ctx) => {
    const map = await serverGetEntity<DependencyMap>(ctx.userId, KIND_DEPMAP, DM_ID);
    if (!map) return { added: false };
    const { map: next, added } = addEdge(map, params.from, params.to, params.kind);
    if (added) await serverUpsertEntity<DependencyMap>(ctx.userId, KIND_DEPMAP, next);
    return { added };
  },
});
