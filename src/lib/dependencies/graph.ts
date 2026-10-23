/**
 * How dependencies hold work up, shared by the Dependency Map page and the
 * tool.dependency_map.* agent actions so both count the same edges and
 * find the same cycles.
 *
 * Direction: an edge is stored as written ("Checkout needs Payments API",
 * "Auth blocks Checkout"). The work flows the other way for "needs": the
 * provider (Payments API) has to deliver before the consumer (Checkout) can
 * finish. `flow()` turns both blocking kinds into provider → consumer.
 */

import type { DependencyEdge, DependencyMap, DependencyNode } from "@/lib/stores/workspace-types";
import { edgeStatus, validEdges } from "./edges";

export type EdgeKind = DependencyEdge["kind"];
export const EDGE_KINDS: readonly EdgeKind[] = ["blocks", "needs", "informs"];

/** What each kind means, for the type picker's tooltips. */
export const KIND_MEANING: Record<EdgeKind, string> = {
  blocks: "The first side must finish before the second can.",
  needs: "The first side waits on something from the second.",
  informs: "No waiting: the second side should hear about changes.",
};

const KNOWN_KINDS = new Set<string>(EDGE_KINDS);

/**
 * Edges the analyses can trust: both ends still on the map (old data and
 * hand-edited payloads keep edges to removed nodes), not a self-edge, and a
 * known kind. An unknown kind would be drawn but skipped by the cycle check,
 * which reads as a contradiction.
 */
export function cleanEdges(map: Pick<DependencyMap, "nodes" | "edges">): DependencyEdge[] {
  return validEdges(map).filter((e) => e.from !== e.to && KNOWN_KINDS.has(e.kind));
}

export const isBlocking = (e: Pick<DependencyEdge, "kind">) =>
  e.kind === "blocks" || e.kind === "needs";

/** The edge in delivery order: who delivers, and who waits. */
export function flow(e: Pick<DependencyEdge, "from" | "to" | "kind">): {
  provider: string;
  consumer: string;
} {
  return e.kind === "needs"
    ? { provider: e.to, consumer: e.from }
    : { provider: e.from, consumer: e.to };
}

/**
 * Unresolved blocking edges: what still holds work up. A resolved
 * dependency no longer blocks, so it can't close a cycle or lengthen the
 * critical path.
 */
export function blockingEdges(edges: readonly DependencyEdge[]): DependencyEdge[] {
  return edges.filter((e) => isBlocking(e) && edgeStatus(e) !== "resolved");
}

/** provider → consumers, over the given edges. */
export function adjacency(edges: readonly DependencyEdge[]): Map<string, DependencyEdge[]> {
  const adj = new Map<string, DependencyEdge[]>();
  for (const e of edges) {
    const { provider } = flow(e);
    const list = adj.get(provider) ?? [];
    list.push(e);
    adj.set(provider, list);
  }
  return adj;
}

/**
 * Circular waits among unresolved blocking edges, each as a node-id ring
 * that starts and ends on the same node. Each cycle is reported once,
 * rotated to start at its smallest id (DFS from every node would otherwise
 * report a 3-cycle three times).
 */
export function detectCycles(nodes: readonly DependencyNode[], edges: readonly DependencyEdge[]) {
  const adj = adjacency(blockingEdges(edges));
  const cycles: string[][] = [];
  const visiting = new Set<string>();
  const done = new Set<string>();
  const dfs = (u: string, stack: string[]) => {
    if (visiting.has(u)) {
      const idx = stack.indexOf(u);
      if (idx >= 0) cycles.push(stack.slice(idx));
      return;
    }
    if (done.has(u)) return;
    visiting.add(u);
    for (const e of adj.get(u) ?? []) dfs(flow(e).consumer, stack.concat(u));
    visiting.delete(u);
    done.add(u);
  };
  for (const n of nodes) dfs(n.id, []);

  const seen = new Set<string>();
  const unique: string[][] = [];
  for (const ring of cycles) {
    if (ring.length < 2) continue;
    let pivot = 0;
    for (let i = 1; i < ring.length; i++) if (ring[i] < ring[pivot]) pivot = i;
    const rotated = [...ring.slice(pivot), ...ring.slice(0, pivot)];
    const key = rotated.join(">");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push([...rotated, rotated[0]]);
  }
  return unique;
}
