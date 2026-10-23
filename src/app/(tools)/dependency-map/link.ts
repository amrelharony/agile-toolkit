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
import { isExampleId } from "@/components/tool-frame/example-data";
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
import { flow } from "./graph";

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

const labelKey = (s: string | undefined) => (s ?? "").trim().toLowerCase();

/**
 * Which nodes a link may find by name. A real dependency never lands on an
 * example node: "Clear example" takes an example node's edges with it, so
 * a PI item linked to the example's "Checkout" would lose its edge. An
 * example's links stay among that example's own nodes (`examplePrefix`),
 * so loading one never reads or writes the user's dependencies.
 */
export function nodeInScope(examplePrefix?: string): (node: DependencyNode) => boolean {
  return examplePrefix ? (n) => n.id.startsWith(examplePrefix) : (n) => !isExampleId(n.id);
}

/**
 * Link a dependency on the live map: find or add both sides by label and
 * add the edge, or reuse an identical open one. Only nodes in scope (see
 * `nodeInScope`) are found; with an `examplePrefix`, new ids carry it too.
 *
 * Null, and nothing written, when both sides name the same thing: a team
 * can't wait on itself, and the map hides a self-edge, so nobody could see
 * or remove it there.
 */
export function linkDependency(
  input: DependencyLinkInput,
  makeId?: () => string,
  examplePrefix?: string
): LinkResult | null {
  if (!labelKey(input.from) || !labelKey(input.to) || labelKey(input.from) === labelKey(input.to)) {
    return null;
  }
  const newId = makeId ?? (() => `${examplePrefix ?? ""}${nanoid(6)}`);
  const before = currentDependencyMap() ?? EMPTY;
  const visible = before.nodes.filter(nodeInScope(examplePrefix));
  const known = new Set(before.nodes.map((n) => n.id));
  const hadEdge = new Set(before.edges.map((e) => e.id));
  const next = withDependencyLink({ nodes: visible, edges: before.edges }, input, newId);
  const added = next.nodes.filter((n) => !known.has(n.id));
  saveDependencyMap({ nodes: [...before.nodes, ...added], edges: next.edges });
  return {
    edgeId: next.edgeId,
    addedEdge: !hadEdge.has(next.edgeId),
    addedNodes: added.map((n) => n.id),
  };
}

type EdgeDetails = Partial<Pick<DependencyEdge, "owner" | "due" | "note">>;

/**
 * Give an edge the details a link brought along. Each field fills a gap the
 * edge has; a field listed in `replace` (a due date the user just typed)
 * overwrites what's there. A reused edge used to drop them silently.
 */
export function patchEdge(
  edgeId: string,
  details: EdgeDetails,
  replace: readonly (keyof EdgeDetails)[] = []
): void {
  updateDependencyMap((map) => ({
    nodes: map.nodes,
    edges: map.edges.map((e) => {
      if (e.id !== edgeId) return e;
      const next = { ...e };
      for (const field of ["owner", "due", "note"] as const) {
        const value = details[field];
        if (value && (replace.includes(field) || !next[field])) next[field] = value;
      }
      return next;
    }),
  }));
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

/** What `releaseEdges` did, so Undo can put it back. */
export interface ReleasedEdges {
  taken: TakenEdges;
  /** Edges passed to another item, with the `sourceRef` they had before. */
  handed: { id: string; sourceRef?: HandoffRef }[];
}

/** Who else still shows an edge (another PI item, a Scrum of Scrums entry), if anyone. */
export type EdgeHeir = (edge: DependencyEdge) => HandoffRef | undefined;

/**
 * Let go of edges an item drew, because it is being deleted, moved or no
 * longer is a dependency. An edge that another item still shows stays on
 * the map and passes to that item (its `sourceRef`), so the other item
 * keeps its status, owner and due date; the rest come off the map. Before,
 * whoever drew a shared edge first took it with them.
 */
export function releaseEdges(ids: readonly string[], heir: EdgeHeir): ReleasedEdges {
  const handed: ReleasedEdges["handed"] = [];
  if (ids.length === 0) return { taken: [], handed };
  const want = new Set(ids);
  const heirs = new Map<string, HandoffRef>();
  for (const e of (currentDependencyMap() ?? EMPTY).edges) {
    const ref = want.has(e.id) ? heir(e) : undefined;
    if (ref) heirs.set(e.id, ref);
  }
  if (heirs.size > 0) {
    updateDependencyMap((map) => ({
      nodes: map.nodes,
      edges: map.edges.map((e) => {
        const ref = heirs.get(e.id);
        if (!ref) return e;
        handed.push({ id: e.id, ...(e.sourceRef ? { sourceRef: e.sourceRef } : {}) });
        return { ...e, sourceRef: ref };
      }),
    }));
  }
  return { taken: takeEdges(ids.filter((id) => !heirs.has(id))), handed };
}

/** Undo a `releaseEdges`: taken edges go back, handed ones get their old `sourceRef`. */
export function restoreReleased(released: ReleasedEdges): void {
  restoreEdges(released.taken);
  if (released.handed.length === 0) return;
  const before = new Map(released.handed.map((h) => [h.id, h.sourceRef]));
  updateDependencyMap((map) => ({
    nodes: map.nodes,
    edges: map.edges.map((e) => {
      if (!before.has(e.id)) return e;
      const next = { ...e };
      const ref = before.get(e.id);
      if (ref) next.sourceRef = ref;
      else delete next.sourceRef;
      return next;
    }),
  }));
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

/** The wait an item describes: `from` waits on `to`. */
export interface WaitSides {
  from: string;
  to: string;
  /**
   * When the item was raised (an ISO timestamp or day). An edge resolved
   * before then can't be what it waits on.
   */
  since?: string;
}

/**
 * The edge for a tool's item: the one it drew (matching `sourceRef`), else
 * one someone else drew for the same wait: "Checkout needs Payments" from
 * PI Planning shows on the Scrum of Scrums entry that says Checkout waits
 * on Payments, and so does "Payments blocks Checkout" (matched in delivery
 * order, so "Checkout blocks Payments", where Payments waits, never is).
 *
 * A borrowed edge counts only while it can be this wait. One resolved at or
 * after `since` is the dependency the item was waiting on, now delivered,
 * so it wins over an open one, which is a newer dependency between the same
 * teams. One resolved before `since` was an earlier dependency, and one
 * resolved without a date can't be placed, so neither counts; with no
 * `since`, only unresolved edges do.
 */
export function findLinkedEdge(
  map: MapGraph,
  ref: HandoffRef,
  sides?: WaitSides,
  examplePrefix?: string
): DependencyEdge | undefined {
  const own = map.edges.find((e) => sameRef(e.sourceRef, ref));
  if (own || !sides?.from.trim() || !sides.to.trim()) return own;
  const nodes = map.nodes.filter(nodeInScope(examplePrefix));
  const waiting = findNodeByLabel(nodes, sides.from);
  const on = findNodeByLabel(nodes, sides.to);
  if (!waiting || !on || waiting.id === on.id) return undefined;
  const matches = map.edges.filter((e) => {
    if (e.kind !== "needs" && e.kind !== "blocks") return false;
    const { provider, consumer } = flow(e);
    return consumer === waiting.id && provider === on.id;
  });
  const since = sides.since;
  const delivered = since
    ? matches.find((e) => edgeStatus(e) === "resolved" && (e.resolvedAt ?? "") >= since)
    : undefined;
  return delivered ?? matches.find((e) => edgeStatus(e) !== "resolved");
}

/** "Checkout" and "Payments API" for an edge, as stored (from, to). */
export function edgeSides(map: MapGraph, edge: DependencyEdge): { from: string; to: string } {
  return { from: nodeLabel(map.nodes, edge.from), to: nodeLabel(map.nodes, edge.to) };
}

/** Who waits (`from`) on whom (`to`) for an edge, whichever way its kind stores it. */
export function waitOf(map: MapGraph, edge: DependencyEdge): { from: string; to: string } {
  const { provider, consumer } = flow(edge);
  return { from: nodeLabel(map.nodes, consumer), to: nodeLabel(map.nodes, provider) };
}
