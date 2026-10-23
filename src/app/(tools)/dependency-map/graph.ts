/**
 * The Dependency Map's analyses: which edges to trust, cycles, the critical
 * path with its due dates, and the layered layout the SVG draws.
 *
 * Direction: an edge is stored as written ("Checkout needs Payments API",
 * "Auth blocks Checkout"). The work flows the other way for "needs": the
 * provider (Payments API) has to deliver before the consumer (Checkout) can
 * finish. `flow()` turns both blocking kinds into provider → consumer, so
 * the graph reads left to right and the critical path in delivery order.
 *
 * Pure, so the client, the Markdown export and the tests agree.
 */

import type {
  DependencyEdge,
  DependencyMap,
  DependencyNode,
  ISODateString,
} from "@/lib/stores/workspace-types";
import { edgeStatus, isOverdue, validEdges } from "@/lib/dependencies/edges";

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
function adjacency(edges: readonly DependencyEdge[]): Map<string, DependencyEdge[]> {
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

/** One link on the critical path, in delivery order. */
export interface PathStep {
  edge: DependencyEdge;
  provider: string;
  consumer: string;
  overdue: boolean;
  atRisk: boolean;
  /**
   * Due before a link earlier in the chain: the consumer's deadline comes
   * before the work it waits on is due, so it can't be met as planned.
   */
  dueBeforeUpstream: boolean;
}

export interface CriticalPath {
  /** Node ids, provider first. Empty when nothing blocks or a cycle exists. */
  nodes: string[];
  steps: PathStep[];
}

const NO_PATH: CriticalPath = { nodes: [], steps: [] };

/** The earliest due date on a chain ("" sorts after any date when absent). */
const earliestDue = (edges: readonly DependencyEdge[]) =>
  edges.reduce<string>((min, e) => (e.due && (!min || e.due < min) ? e.due : min), "");

interface Chain {
  nodes: string[];
  edges: DependencyEdge[];
}

/**
 * Longer wins; on a tie the chain with the earlier due date (more urgent),
 * then the one whose node ids sort first, so the answer doesn't depend on
 * the order edges were drawn.
 */
function better(a: Chain, b: Chain): boolean {
  if (a.edges.length !== b.edges.length) return a.edges.length > b.edges.length;
  const da = earliestDue(a.edges);
  const db = earliestDue(b.edges);
  if (da !== db) return Boolean(da) && (!db || da < db);
  return a.nodes.join(">") < b.nodes.join(">");
}

/**
 * The longest chain of unresolved blocking links, each step with its due
 * date and flags: overdue, marked at risk, or due before a link it waits on.
 *
 * Longest-path is only defined on a DAG: with a cycle there is no answer
 * (the caller says so instead of showing a half-result).
 */
export function criticalPath(
  nodes: readonly DependencyNode[],
  edges: readonly DependencyEdge[],
  today: ISODateString
): CriticalPath {
  if (detectCycles(nodes, edges).length > 0) return NO_PATH;
  const adj = adjacency(blockingEdges(edges));
  const memo = new Map<string, Chain>();
  const visit = (u: string): Chain => {
    const hit = memo.get(u);
    if (hit) return hit;
    let best: Chain = { nodes: [u], edges: [] };
    for (const e of adj.get(u) ?? []) {
      const sub = visit(flow(e).consumer);
      const candidate: Chain = { nodes: [u, ...sub.nodes], edges: [e, ...sub.edges] };
      if (better(candidate, best)) best = candidate;
    }
    memo.set(u, best);
    return best;
  };
  let overall: Chain = { nodes: [], edges: [] };
  for (const n of nodes) {
    const c = visit(n.id);
    if (c.edges.length > 0 && (overall.edges.length === 0 || better(c, overall))) overall = c;
  }
  if (overall.edges.length === 0) return NO_PATH;

  let latestUpstream = "";
  const steps = overall.edges.map((edge): PathStep => {
    const { provider, consumer } = flow(edge);
    const dueBeforeUpstream = Boolean(edge.due && latestUpstream && edge.due < latestUpstream);
    if (edge.due && edge.due > latestUpstream) latestUpstream = edge.due;
    return {
      edge,
      provider,
      consumer,
      overdue: isOverdue(edge, today),
      atRisk: edgeStatus(edge) === "at-risk",
      dueBeforeUpstream,
    };
  });
  return { nodes: overall.nodes, steps };
}

/* ── Layout ─────────────────────────────────────────────────────────── */

export interface GraphLayout {
  /** Node ids per column, left to right (providers first). */
  columns: string[][];
  /** Column and row of each node. */
  position: Map<string, { col: number; row: number }>;
}

/**
 * Topological columns over every blocking edge (resolved ones too, so the
 * picture doesn't rearrange when something is resolved): a node sits one
 * column right of the furthest provider it waits on. Nodes on a cycle can't
 * be ordered, so they are placed one at a time, the one with the fewest
 * unplaced providers first. Within a column, nodes are ordered by where
 * their providers sit (one barycentre pass) to cut down crossings.
 */
export function layoutGraph(
  nodes: readonly DependencyNode[],
  edges: readonly DependencyEdge[]
): GraphLayout {
  const ids = nodes.map((n) => n.id);
  const order = new Map(ids.map((id, i) => [id, i]));
  const providers = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));
  const consumers = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));
  for (const e of edges) {
    if (!isBlocking(e)) continue;
    const { provider, consumer } = flow(e);
    if (!order.has(provider) || !order.has(consumer) || provider === consumer) continue;
    providers.get(consumer)!.add(provider);
    consumers.get(provider)!.add(consumer);
  }

  const col = new Map<string, number>();
  const waiting = new Map(ids.map((id) => [id, providers.get(id)!.size]));
  const place = (id: string) => {
    let c = 0;
    providers.get(id)!.forEach((p) => {
      const pc = col.get(p);
      if (pc !== undefined) c = Math.max(c, pc + 1);
    });
    col.set(id, c);
    consumers.get(id)!.forEach((next) => waiting.set(next, (waiting.get(next) ?? 0) - 1));
  };
  while (col.size < ids.length) {
    const ready = ids.filter((id) => !col.has(id) && (waiting.get(id) ?? 0) <= 0);
    if (ready.length > 0) {
      ready.forEach(place);
      continue;
    }
    // Only cycle members (and what waits on them) are left.
    const next = ids
      .filter((id) => !col.has(id))
      .sort(
        (a, b) => (waiting.get(a) ?? 0) - (waiting.get(b) ?? 0) || order.get(a)! - order.get(b)!
      )[0];
    place(next);
  }

  const width = Math.max(0, ...Array.from(col.values())) + 1;
  const columns: string[][] = Array.from({ length: ids.length ? width : 0 }, () => []);
  for (const id of ids) columns[col.get(id)!].push(id);

  const row = new Map<string, number>();
  columns.forEach((list) => {
    const weight = (id: string) => {
      const rows = Array.from(providers.get(id)!)
        .map((p) => row.get(p))
        .filter((r): r is number => r !== undefined);
      return rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : order.get(id)!;
    };
    list.sort((a, b) => weight(a) - weight(b) || order.get(a)! - order.get(b)!);
    list.forEach((id, i) => row.set(id, i));
  });

  const position = new Map(
    ids.map((id) => [id, { col: col.get(id)!, row: row.get(id)! }] as const)
  );
  return { columns, position };
}
