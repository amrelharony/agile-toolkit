import { exampleId, isExampleId } from "@/components/tool-frame/example-data";
import type { DependencyEdge, DependencyMap, DependencyNode } from "@/lib/stores/workspace-types";
import { dayFrom } from "./format";

type Graph = Pick<DependencyMap, "nodes" | "edges">;

const node = (key: string, label: string, team: string): DependencyNode => ({
  id: exampleId(`dm-${key}`),
  label,
  team,
});

/**
 * A checkout release across five teams. Checkout waits on the Payments API,
 * whose refund endpoint is already late, and Payments waits on Fraud
 * scoring, which is at risk: the critical path runs Fraud scoring →
 * Payments API → Checkout → Mobile app, and Checkout's link is due before
 * the one it waits on. The design-system dependency is done; Analytics only
 * needs to hear about changes. Dates are relative to `now`, so the example
 * always has one overdue link.
 */
export function buildExample(now: Date = new Date()): Graph {
  const nodes = [
    node("checkout", "Checkout", "Web"),
    node("payments", "Payments API", "Payments"),
    node("fraud", "Fraud scoring", "Risk"),
    node("mobile", "Mobile app", "Mobile"),
    node("design", "Design system", "Design"),
    node("analytics", "Analytics", "Data"),
  ];
  const id = (key: string) => exampleId(`dm-${key}`);
  const edges: DependencyEdge[] = [
    {
      id: id("e1"),
      from: id("checkout"),
      to: id("payments"),
      kind: "needs",
      status: "open",
      owner: "Priya",
      due: dayFrom(now, -3),
      note: "Refund endpoint contract",
    },
    {
      id: id("e2"),
      from: id("payments"),
      to: id("fraud"),
      kind: "needs",
      status: "at-risk",
      owner: "Sam",
      due: dayFrom(now, 4),
      note: "Risk score in the authorisation call",
    },
    {
      id: id("e3"),
      from: id("mobile"),
      to: id("checkout"),
      kind: "needs",
      status: "open",
      due: dayFrom(now, 12),
    },
    {
      id: id("e4"),
      from: id("checkout"),
      to: id("design"),
      kind: "needs",
      status: "resolved",
      resolvedAt: new Date(now.getTime() - 5 * 86_400_000).toISOString(),
    },
    { id: id("e5"), from: id("checkout"), to: id("analytics"), kind: "informs", status: "open" },
  ];
  return { nodes, edges };
}

/**
 * The map with the example's nodes and edges gone, and any edge the user
 * drew to an example node (it would dangle). Nothing else is touched, not
 * even an old dangling edge of the user's own.
 */
export function withoutExample(map: Graph): Graph {
  return {
    nodes: map.nodes.filter((n) => !isExampleId(n.id)),
    edges: map.edges.filter((e) => ![e.id, e.from, e.to].some(isExampleId)),
  };
}

/** The map with the example added; a second load replaces the first. */
export function withExample(map: Graph, now: Date = new Date()): Graph {
  const base = withoutExample(map);
  const example = buildExample(now);
  return { nodes: [...base.nodes, ...example.nodes], edges: [...base.edges, ...example.edges] };
}
