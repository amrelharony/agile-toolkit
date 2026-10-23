/**
 * Where a Scrum of Scrums entry went: a dependency's edge on the Dependency
 * Map, a blocker's impediment.
 *
 * `SosEntry` has no `sentTo` of its own, so both links are found from the
 * other side: the edge or impediment records `sourceRef` = this entry. A
 * dependency also picks up an edge someone else drew between the same two
 * teams (PI Planning's "Checkout needs Payments"), so the same dependency
 * is never tracked twice.
 */

import type {
  DependencyEdge,
  HandoffLink,
  HandoffRef,
  Impediment,
  SosEntry,
} from "@/lib/stores/workspace-types";
import { edgeStatus } from "@/lib/dependencies/edges";
import {
  currentDependencyMap,
  edgeSides,
  findLinkedEdge,
  linkDependency,
  sameRef,
  takeEdges,
  type MapGraph,
} from "../dependency-map/link";

const EMPTY: MapGraph = { nodes: [], edges: [] };
const key = (s: string | undefined) => (s ?? "").trim().toLowerCase();

export const entryRef = (e: Pick<SosEntry, "id">): HandoffRef => ({
  tool: "scrum-of-scrums",
  id: e.id,
});

/** The edge a dependency entry shows: its own, or one between the same two teams. */
export function edgeForEntry(map: MapGraph, entry: SosEntry): DependencyEdge | undefined {
  if (entry.kind !== "dependency") return undefined;
  return findLinkedEdge(map, entryRef(entry), { from: entry.team, to: entry.blockedBy ?? "" });
}

/** Edges this entry drew itself (Delete takes them with it, Undo brings them back). */
export function ownEdgeIds(map: MapGraph, entry: SosEntry): string[] {
  return map.edges.filter((e) => sameRef(e.sourceRef, entryRef(entry))).map((e) => e.id);
}

/** Impediments raised from this entry, as hand-off links for `sendHandoff`. */
export function impedimentLinks(
  impediments: readonly Impediment[] | undefined,
  entry: SosEntry
): HandoffLink[] {
  return (impediments ?? [])
    .filter((i) => sameRef(i.sourceRef, entryRef(entry)))
    .map((i) => ({ route: "impediment", targetId: i.id, at: i.raisedAt }));
}

/**
 * After an edit, keep the entry's own edge on the two teams it now names,
 * keeping its owner, due date, note and at-risk flag. An entry that is no
 * longer a dependency (or no longer names who it waits on) takes its own
 * edge off the map. Edges other tools drew are left alone.
 */
export function syncEntryEdge(prev: SosEntry, next: SosEntry): void {
  const map = currentDependencyMap() ?? EMPTY;
  const own = map.edges.find((e) => sameRef(e.sourceRef, entryRef(prev)));
  if (!own) return;
  const waitsOn = next.blockedBy?.trim();
  if (next.kind !== "dependency" || !waitsOn) {
    takeEdges([own.id]);
    return;
  }
  const sides = edgeSides(map, own);
  if (key(sides.from) === key(next.team) && key(sides.to) === key(waitsOn)) return;
  takeEdges([own.id]);
  linkDependency({
    from: next.team,
    to: waitsOn,
    kind: "needs",
    status: edgeStatus(own) === "at-risk" ? "at-risk" : "open",
    owner: own.owner,
    due: own.due,
    note: own.note ?? next.text,
    sourceRef: entryRef(next),
  });
}
