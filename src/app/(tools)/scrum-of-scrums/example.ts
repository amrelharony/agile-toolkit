import { exampleId, isExampleId } from "@/components/tool-frame/example-data";
import type { DependencyMap, SosEntry } from "@/lib/stores/workspace-types";
import { dayFrom } from "../dependency-map/format";

type Row = [
  key: string,
  daysAgo: number,
  team: string,
  kind: SosEntry["kind"],
  text: string,
  blockedBy?: string,
  resolvedDaysAgo?: number,
];

/**
 * Two meetings of a release train, a week apart. Last week's open blocker
 * (Mobile waiting on Platform's push certificates) and dependency (Checkout
 * waiting on Payments' refund contract) carry forward to today, where the
 * blocker is now stale; one of last week's blockers was resolved since.
 * Dates are relative to `now`.
 */
const ROWS: Row[] = [
  ["1", 7, "Mobile", "blocker", "Waiting on the push-notification certificates", "Platform"],
  ["2", 7, "Checkout", "dependency", "Refund API contract for the returns page", "Payments"],
  ["3", 7, "Payments", "update", "Webhooks v2 is in staging"],
  ["4", 7, "All teams", "decision", "The release branch freezes on Thursdays at noon"],
  ["5", 7, "Data", "blocker", "Warehouse credentials expired", "Platform", 5],
  ["6", 0, "Checkout", "update", "Guest checkout is live behind a flag"],
  ["7", 0, "Mobile", "dependency", "Guest checkout endpoint for the app", "Checkout"],
  ["8", 0, "Payments", "blocker", "Fraud-scoring sandbox down since Monday", "Risk"],
  ["9", 0, "Mobile", "decision", "Ship the iOS release without saved cards"],
];

export function buildExample(now: Date = new Date()): SosEntry[] {
  return ROWS.map(([key, daysAgo, team, kind, text, blockedBy, resolvedDaysAgo], i) => {
    const meetingDate = dayFrom(now, -daysAgo);
    const entry: SosEntry = {
      id: exampleId(`sos-${key}`),
      meetingDate,
      team,
      kind,
      text,
      status: resolvedDaysAgo === undefined ? "open" : "resolved",
      // A second apart, so the agenda keeps this order.
      loggedAt: new Date(`${meetingDate}T09:00:${String(i).padStart(2, "0")}`).toISOString(),
    };
    if (blockedBy) entry.blockedBy = blockedBy;
    if (resolvedDaysAgo !== undefined) entry.resolvedAt = dayFrom(now, -resolvedDaysAgo);
    return entry;
  });
}

/**
 * Nodes and edges that example entries put on the Dependency Map ("Add
 * dependency" on one of them) have ids starting with this, and example
 * entries find teams only among those nodes, never the user's own.
 */
export const SOS_EXAMPLE_MAP_PREFIX = exampleId("sos-map-");

/**
 * The map without what example entries drew: their edges, and their nodes
 * unless one of the user's own edges was drawn to it since (that node stays
 * with it, and the Dependency Map's own "Clear example" offers Undo).
 */
export function withoutExampleEdges(
  map: Pick<DependencyMap, "nodes" | "edges">
): Pick<DependencyMap, "nodes" | "edges"> {
  const mine = (id: string) => id.startsWith(SOS_EXAMPLE_MAP_PREFIX);
  const edges = map.edges.filter(
    (e) => !mine(e.id) && !(e.sourceRef?.tool === "scrum-of-scrums" && isExampleId(e.sourceRef.id))
  );
  return {
    nodes: map.nodes.filter(
      (n) => !mine(n.id) || edges.some((e) => e.from === n.id || e.to === n.id)
    ),
    edges,
  };
}
