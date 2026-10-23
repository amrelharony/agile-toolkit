/**
 * Reading and writing the one dependency map from any tool.
 *
 * PI Planning and Scrum of Scrums no longer keep dependencies of their own:
 * an item that waits on another team links to an edge here, shows that
 * edge's live status, and resolves it in place. These helpers wrap the pure
 * `withDependencyLink` / `withEdgeStatus` (lib/dependencies/edges) around
 * the workspace singleton, and record what a link added so Undo can take
 * back exactly that and nothing a reused edge already had.
 */

import { nanoid } from "nanoid";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  DependencyEdge,
  DependencyMap,
  DependencyNode,
  DependencyStatus,
  HandoffRef,
} from "@/lib/stores/workspace-types";
import {
  edgeStatus,
  findNodeByLabel,
  withDependencyLink,
  withEdgeStatus,
  type DependencyLinkInput,
} from "@/lib/dependencies/edges";
import { DEPENDENCY_MAP_ID, currentDependencyMap } from "@/lib/handoffs/targets/dependency";

export { DEPENDENCY_MAP_ID, currentDependencyMap };

export type MapGraph = Pick<DependencyMap, "nodes" | "edges">;

const EMPTY: MapGraph = { nodes: [], edges: [] };

/** The map, subscribed; an empty graph before anything was drawn. */
export function useDependencyMap(): MapGraph {
  const doc = useWorkspaceStore(
    useShallow((s) => (s.dependencyMaps ?? []).find((d) => d.id === DEPENDENCY_MAP_ID))
  );
  return doc ?? EMPTY;
}

/** Replace the map's graph (the singleton id never changes). */
export function saveDependencyMap(graph: MapGraph): void {
  useWorkspaceStore
    .getState()
    .upsertDependencyMap({ nodes: graph.nodes, edges: graph.edges, id: DEPENDENCY_MAP_ID });
}

/** Change the live map with a pure function of its current graph. */
export function updateDependencyMap(fn: (graph: MapGraph) => MapGraph): void {
  saveDependencyMap(fn(currentDependencyMap() ?? EMPTY));
}

export const sameRef = (a: HandoffRef | undefined, b: HandoffRef | undefined) =>
  Boolean(a && b && a.tool === b.tool && a.id === b.id && (a.doc ?? "") === (b.doc ?? ""));

/** What one link call put on the map. */
export interface LinkResult {
  edgeId: string;
  /** True when the edge is new; false when an identical open edge was reused. */
  addedEdge: boolean;
  /** Nodes created for sides that weren't on the map yet. */
  addedNodes: string[];
}

/**
 * Link a dependency on the live map: find or add both sides by label and
 * add the edge, or reuse an identical open one.
 */
export function linkDependency(
  input: DependencyLinkInput,
  makeId: () => string = () => nanoid(6)
): LinkResult {
  const before = currentDependencyMap() ?? EMPTY;
  const known = new Set(before.nodes.map((n) => n.id));
  const hadEdge = new Set(before.edges.map((e) => e.id));
  const next = withDependencyLink(before, input, makeId);
  saveDependencyMap(next);
  return {
    edgeId: next.edgeId,
    addedEdge: !hadEdge.has(next.edgeId),
    addedNodes: next.nodes.filter((n) => !known.has(n.id)).map((n) => n.id),
  };
}

/**
 * Undo a `linkDependency`: remove the edge it added, and the nodes it added
 * when nothing else has been connected to them since.
 */
export function unlink(result: LinkResult): void {
  updateDependencyMap((map) => {
    const edges = result.addedEdge ? map.edges.filter((e) => e.id !== result.edgeId) : map.edges;
    const added = new Set(result.addedNodes);
    const nodes = map.nodes.filter(
      (n) => !added.has(n.id) || edges.some((e) => e.from === n.id || e.to === n.id)
    );
    return { nodes, edges };
  });
}

/** Edges taken off the map, with where they sat, so Undo can put them back. */
export type TakenEdges = { item: DependencyEdge; index: number }[];

/**
 * Take edges off the live map (an item that drew them is being deleted).
 * Their nodes stay: a team or deliverable is still on the map without them.
 */
export function takeEdges(ids: readonly string[]): TakenEdges {
  const drop = new Set(ids);
  let taken: TakenEdges = [];
  if (drop.size === 0) return taken;
  updateDependencyMap((map) => {
    taken = map.edges.flatMap((item, index) => (drop.has(item.id) ? [{ item, index }] : []));
    return { nodes: map.nodes, edges: map.edges.filter((e) => !drop.has(e.id)) };
  });
  return taken;
}

/** Put taken edges back at their old positions (clamped to the list as it is now). */
export function restoreEdges(taken: TakenEdges): void {
  if (taken.length === 0) return;
  updateDependencyMap((map) => {
    const ids = new Set(map.edges.map((e) => e.id));
    const edges = [...map.edges];
    for (const { item, index } of taken) {
      if (!ids.has(item.id)) edges.splice(Math.min(index, edges.length), 0, item);
    }
    return { nodes: map.nodes, edges };
  });
}

export function edgeById(map: MapGraph, id: string | undefined): DependencyEdge | undefined {
  return id ? map.edges.find((e) => e.id === id) : undefined;
}

/** Set an edge's status on the live map (resolving stamps resolvedAt). */
export function setEdgeStatus(edgeId: string, status: DependencyStatus, now = new Date()): void {
  updateDependencyMap((map) => ({
    nodes: map.nodes,
    edges: map.edges.map((e) => (e.id === edgeId ? withEdgeStatus(e, status, now) : e)),
  }));
}

const nodeLabel = (nodes: readonly DependencyNode[], id: string) =>
  nodes.find((n) => n.id === id)?.label ?? "";

/**
 * The edge for a tool's item: the one it drew (matching `sourceRef`), else
 * an edge between the same two labelled sides that someone else drew
 * ("Checkout needs Payments" from PI Planning shows on the Scrum of Scrums
 * entry that says the same). An unresolved match wins over a resolved one.
 */
export function findLinkedEdge(
  map: MapGraph,
  ref: HandoffRef,
  sides?: { from: string; to: string }
): DependencyEdge | undefined {
  const own = map.edges.find((e) => sameRef(e.sourceRef, ref));
  if (own || !sides?.from.trim() || !sides.to.trim()) return own;
  const from = findNodeByLabel(map.nodes, sides.from);
  const to = findNodeByLabel(map.nodes, sides.to);
  if (!from || !to) return undefined;
  const matches = map.edges.filter(
    (e) => e.from === from.id && e.to === to.id && (e.kind === "needs" || e.kind === "blocks")
  );
  return matches.find((e) => edgeStatus(e) !== "resolved") ?? matches[0];
}

/** "Checkout" and "Payments API" for an edge, as stored (from, to). */
export function edgeSides(map: MapGraph, edge: DependencyEdge): { from: string; to: string } {
  return { from: nodeLabel(map.nodes, edge.from), to: nodeLabel(map.nodes, edge.to) };
}
