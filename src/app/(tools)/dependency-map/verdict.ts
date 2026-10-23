import type { DependencyEdge, DependencyMap, ISODateString } from "@/lib/stores/workspace-types";
import { edgeStatus, edgeSummary, isOverdue } from "@/lib/dependencies/edges";
import { plural } from "@/lib/charts/chart-text";
import { dayLabel } from "./format";
import { cleanEdges, flow } from "./graph";

type Graph = Pick<DependencyMap, "nodes" | "edges">;

const dependencies = (n: number) => `${n} open ${n === 1 ? "dependency" : "dependencies"}`;

/** "Payments API → Checkout": who delivers, then who waits. */
export function flowText(map: Graph, e: DependencyEdge): string {
  const label = (id: string) => map.nodes.find((n) => n.id === id)?.label ?? id;
  const { provider, consumer } = flow(e);
  return `${label(provider)} → ${label(consumer)}`;
}

/** Due date first; undated last. */
const byDue = (a: DependencyEdge, b: DependencyEdge) =>
  (a.due ?? "9999").localeCompare(b.due ?? "9999");

/**
 * The one-sentence answer above the map: how much is still open, and the
 * dependency to chase first (the most overdue, else the next one due).
 *
 *   "3 open dependencies (1 at risk), 1 overdue: Payments API → Checkout, due 2 Nov."
 */
export function dependencyVerdict(map: Graph, today: ISODateString): string {
  if (map.nodes.length === 0) return "Nothing on the map yet.";
  const edges = cleanEdges(map);
  if (edges.length === 0) {
    return `${plural(map.nodes.length, "node")} on the map, with no dependencies between them yet.`;
  }
  const open = edges.filter((e) => edgeStatus(e) !== "resolved");
  if (open.length === 0) {
    return edges.length === 1
      ? "The one dependency on the map is resolved."
      : `All ${edges.length} dependencies on the map are resolved.`;
  }
  const s = edgeSummary(edges, today);
  const lead = `${dependencies(open.length)}${s.atRisk > 0 ? ` (${s.atRisk} at risk)` : ""}`;
  const overdue = open.filter((e) => isOverdue(e, today)).sort(byDue);
  if (overdue.length > 0) {
    const first = overdue[0];
    const which = overdue.length > 1 ? ", the oldest" : "";
    return `${lead}, ${overdue.length} overdue${which}: ${flowText(map, first)}, due ${dayLabel(first.due)}.`;
  }
  const next = open.filter((e) => e.due).sort(byDue)[0];
  if (!next) return `${lead}, none with a due date yet.`;
  return `${lead}, none overdue; next due: ${flowText(map, next)}, ${dayLabel(next.due)}.`;
}
