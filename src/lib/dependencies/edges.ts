/**
 * The one dependency model: the Dependency Map's edges, with a status, an
 * owner and a due date. Dependency Map draws and edits them; PI Planning and
 * Scrum of Scrums create and resolve them through these helpers (and the
 * `dependency` hand-off route), and agents through tool.dependency_map.*.
 *
 * Pure, so the map, the boards, the MCP actions and the tests agree.
 */

import type {
  DependencyEdge,
  DependencyMap,
  DependencyNode,
  DependencyStatus,
  ISODateString,
} from "@/lib/stores/workspace-types";

export const DEPENDENCY_STATUSES: readonly DependencyStatus[] = ["open", "at-risk", "resolved"];

export const DEPENDENCY_STATUS_LABEL: Record<DependencyStatus, string> = {
  open: "Open",
  "at-risk": "At risk",
  resolved: "Resolved",
};

export function isDependencyStatus(value: unknown): value is DependencyStatus {
  return typeof value === "string" && (DEPENDENCY_STATUSES as readonly string[]).includes(value);
}

/** An edge's status; edges drawn before statuses existed read as open. */
export function edgeStatus(edge: Pick<DependencyEdge, "status">): DependencyStatus {
  return isDependencyStatus(edge.status) ? edge.status : "open";
}

/** True when the edge is unresolved and its due date (YYYY-MM-DD) is before `today`. */
export function isOverdue(
  edge: Pick<DependencyEdge, "status" | "due">,
  today: ISODateString
): boolean {
  return edgeStatus(edge) !== "resolved" && Boolean(edge.due) && (edge.due as string) < today;
}

/** The edge with a new status; resolving stamps `resolvedAt`, reopening clears it. */
export function withEdgeStatus(
  edge: DependencyEdge,
  status: DependencyStatus,
  now: Date = new Date()
): DependencyEdge {
  if (status === "resolved") {
    return { ...edge, status, resolvedAt: edge.resolvedAt ?? now.toISOString() };
  }
  const next: DependencyEdge = { ...edge, status };
  delete next.resolvedAt;
  return next;
}

export interface EdgeSummary {
  open: number;
  atRisk: number;
  resolved: number;
  overdue: number;
}

/** Counts by status, plus the unresolved ones past their due date. */
export function edgeSummary(edges: readonly DependencyEdge[], today: ISODateString): EdgeSummary {
  const out: EdgeSummary = { open: 0, atRisk: 0, resolved: 0, overdue: 0 };
  for (const e of edges) {
    const s = edgeStatus(e);
    if (s === "open") out.open++;
    else if (s === "at-risk") out.atRisk++;
    else out.resolved++;
    if (isOverdue(e, today)) out.overdue++;
  }
  return out;
}

const labelKey = (label: string) => label.trim().toLowerCase();

/** The node with this label (trimmed, case-insensitive), if any. */
export function findNodeByLabel(
  nodes: readonly DependencyNode[],
  label: string
): DependencyNode | undefined {
  const key = labelKey(label);
  return key ? nodes.find((n) => labelKey(n.label) === key) : undefined;
}

export interface DependencyLinkInput {
  /** The side that waits (a team, workstream or deliverable). */
  from: string;
  /** The side it waits on. */
  to: string;
  kind?: DependencyEdge["kind"];
  status?: DependencyStatus;
  owner?: string;
  due?: ISODateString;
  note?: string;
  sourceRef?: DependencyEdge["sourceRef"];
}

/**
 * The map with a dependency between two labelled sides, adding a node for a
 * side that isn't on the map yet. An identical open edge (same ends and
 * kind) is reused rather than duplicated. Returns the edge id too, so the
 * caller can link back to it.
 */
export function withDependencyLink(
  map: Pick<DependencyMap, "nodes" | "edges"> | undefined,
  input: DependencyLinkInput,
  makeId: () => string
): { nodes: DependencyNode[]; edges: DependencyEdge[]; edgeId: string } {
  const nodes = [...(map?.nodes ?? [])];
  const edges = [...(map?.edges ?? [])];
  const side = (label: string): DependencyNode => {
    const found = findNodeByLabel(nodes, label);
    if (found) return found;
    const node: DependencyNode = { id: makeId(), label: label.trim() };
    nodes.push(node);
    return node;
  };
  const from = side(input.from);
  const to = side(input.to);
  const kind = input.kind ?? "needs";
  const existing = edges.find(
    (e) => e.from === from.id && e.to === to.id && e.kind === kind && edgeStatus(e) !== "resolved"
  );
  if (existing) return { nodes, edges, edgeId: existing.id };
  const edge: DependencyEdge = {
    id: makeId(),
    from: from.id,
    to: to.id,
    kind,
    status: input.status ?? "open",
    ...(input.owner?.trim() ? { owner: input.owner.trim() } : {}),
    ...(input.due ? { due: input.due } : {}),
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    ...(input.sourceRef ? { sourceRef: input.sourceRef } : {}),
  };
  edges.push(edge);
  return { nodes, edges, edgeId: edge.id };
}

/** Edges with valid endpoints only (a removed node leaves its edges dangling in old data). */
export function validEdges(map: Pick<DependencyMap, "nodes" | "edges">): DependencyEdge[] {
  const ids = new Set(map.nodes.map((n) => n.id));
  return map.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
}
