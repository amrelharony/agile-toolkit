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
 *      (idempotent; rejects unknown endpoints), with an optional status,
 *      owner, due date and note.
 *   4. update_edge — change an edge's status, owner, due date or note
 *      (resolving stamps resolvedAt).
 *
 * The edges are the one dependency model (lib/dependencies/edges): PI
 * Planning and Scrum of Scrums create and resolve them too.
 *
 * Entity kind "workspace:dependencyMap" (camelCase via kindFromToolId)
 * matches the browser sync engine so MCP writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type { DependencyMap, DependencyNode, DependencyEdge } from "@/lib/stores/workspace-types";
import { DEPENDENCY_STATUSES, edgeSummary, withEdgeStatus } from "@/lib/dependencies/edges";
import { cleanEdges, detectCycles } from "@/lib/dependencies/graph";
import { todayIso } from "@/lib/sprints/series";

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

function summarize(map: DependencyMap | null) {
  if (!map) {
    return {
      exists: false,
      nodeCount: 0,
      edgeCount: 0,
      byKind: { blocks: 0, needs: 0, informs: 0 },
      byStatus: { open: 0, atRisk: 0, resolved: 0, overdue: 0 },
      hasCycle: false,
    };
  }
  // The edges the page trusts: both ends on the map, no self-edge, a known kind.
  const edges = cleanEdges(map);
  const byKind = { blocks: 0, needs: 0, informs: 0 };
  for (const e of edges) byKind[e.kind] += 1;
  return {
    exists: true,
    nodeCount: map.nodes.length,
    edgeCount: edges.length,
    byKind,
    byStatus: edgeSummary(edges, todayIso()),
    // A circular wait among unresolved blocks/needs edges, read in delivery
    // order ("A needs B" means B delivers first), as the page finds it.
    hasCycle: detectCycles(map.nodes, edges).length > 0,
  };
}

// ──────── tool.dependency_map.list_state ────────
registry.register({
  id: "tool.dependency_map.list_state",
  toolId: "tool.dependency_map",
  name: "list_state",
  category: "read",
  description:
    "Summarise the dependency graph as the Dependency Map shows it (edges with both ends on the map, no self-edges). Returns {exists, nodeCount, edgeCount, byKind: {blocks, needs, informs}, byStatus: {open, atRisk, resolved, overdue}, hasCycle (a circular wait among unresolved blocks/needs edges; 'A needs B' means B delivers first)}.",
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
const EdgeStatus = z.enum(DEPENDENCY_STATUSES as ["open", "at-risk", "resolved"]);
const IsoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const EdgeDetails = {
  status: EdgeStatus.optional().describe("open (default) | at-risk | resolved."),
  owner: z.string().max(120).optional().describe("Who chases it."),
  due: IsoDay.optional().describe("When it must be resolved by (YYYY-MM-DD)."),
  note: z.string().max(2000).optional(),
};
interface EdgeDetailInput {
  status?: DependencyEdge["status"];
  owner?: string;
  due?: string;
  note?: string;
}

function addEdge(
  map: DependencyMap,
  from: string,
  to: string,
  kind: DependencyEdge["kind"],
  details: EdgeDetailInput = {}
): { map: DependencyMap; added: boolean; id?: string } {
  const ids = new Set(map.nodes.map((n) => n.id));
  if (!ids.has(from) || !ids.has(to) || from === to) return { map, added: false };
  // Idempotent: don't duplicate an identical (from,to,kind) edge.
  if (map.edges.some((e) => e.from === from && e.to === to && e.kind === kind)) {
    return { map, added: false };
  }
  const edge = withEdgeStatus(
    {
      id: crypto.randomUUID(),
      from,
      to,
      kind,
      ...(details.owner?.trim() ? { owner: details.owner.trim() } : {}),
      ...(details.due ? { due: details.due } : {}),
      ...(details.note?.trim() ? { note: details.note.trim() } : {}),
    },
    details.status ?? "open"
  );
  return { map: { ...map, edges: [...map.edges, edge] }, added: true, id: edge.id };
}

function updateEdge(
  map: DependencyMap,
  id: string,
  details: EdgeDetailInput
): { map: DependencyMap; updated: boolean } {
  const at = map.edges.findIndex((e) => e.id === id);
  if (at < 0) return { map, updated: false };
  let edge: DependencyEdge = { ...map.edges[at] };
  if (details.owner !== undefined) {
    if (details.owner.trim()) edge.owner = details.owner.trim();
    else delete edge.owner;
  }
  if (details.due !== undefined) edge.due = details.due;
  if (details.note !== undefined) {
    if (details.note.trim()) edge.note = details.note.trim();
    else delete edge.note;
  }
  if (details.status) edge = withEdgeStatus(edge, details.status);
  const edges = [...map.edges];
  edges[at] = edge;
  return { map: { ...map, edges }, updated: true };
}

registry.register({
  id: "tool.dependency_map.add_edge",
  toolId: "tool.dependency_map",
  name: "add_edge",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a directed dependency edge between two existing nodes. kind: blocks | needs | informs; optional status (open | at-risk | resolved), owner, due (YYYY-MM-DD) and note. Idempotent; returns {added: false} when an endpoint is unknown, it's a self-edge, or the edge already exists, else {added: true, id}.",
  paramsSchema: z.object({ from: z.string(), to: z.string(), kind: EdgeKind, ...EdgeDetails }),
  handler: async ({ from, to, kind, ...details }) => {
    const map = browserMap();
    if (!map) return { added: false };
    const { map: next, added, id } = addEdge(map, from, to, kind, details);
    if (added) ws().upsertDependencyMap(next);
    return added ? { added, id } : { added };
  },
  mcpHandler: async ({ from, to, kind, ...details }, ctx) => {
    const map = await serverGetEntity<DependencyMap>(ctx.userId, KIND_DEPMAP, DM_ID);
    if (!map) return { added: false };
    const { map: next, added, id } = addEdge(map, from, to, kind, details);
    if (added) await serverUpsertEntity<DependencyMap>(ctx.userId, KIND_DEPMAP, next);
    return added ? { added, id } : { added };
  },
});

// ──────── tool.dependency_map.update_edge ────────
registry.register({
  id: "tool.dependency_map.update_edge",
  toolId: "tool.dependency_map",
  name: "update_edge",
  category: "write",
  requiresConfirmation: false,
  description:
    "Change a dependency edge's status (open | at-risk | resolved; resolving stamps resolvedAt), owner, due date (YYYY-MM-DD) or note. An empty owner or note clears it. Returns {updated: false} when the edge doesn't exist.",
  paramsSchema: z.object({ id: z.string(), ...EdgeDetails }),
  handler: async ({ id, ...details }) => {
    const map = browserMap();
    if (!map) return { updated: false };
    const { map: next, updated } = updateEdge(map, id, details);
    if (updated) ws().upsertDependencyMap(next);
    return { updated };
  },
  mcpHandler: async ({ id, ...details }, ctx) => {
    const map = await serverGetEntity<DependencyMap>(ctx.userId, KIND_DEPMAP, DM_ID);
    if (!map) return { updated: false };
    const { map: next, updated } = updateEdge(map, id, details);
    if (updated) await serverUpsertEntity<DependencyMap>(ctx.userId, KIND_DEPMAP, next);
    return { updated };
  },
});
