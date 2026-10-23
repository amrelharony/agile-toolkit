/**
 * Where a Scrum of Scrums entry went: a dependency's edge on the Dependency
 * Map, a blocker's impediment.
 *
 * `SosEntry` has no `sentTo` of its own, so both links are found from the
 * other side: the edge or impediment records `sourceRef` = this entry. A
 * dependency also picks up an edge someone else drew for the same wait
 * (PI Planning's "Checkout needs Payments"), so the same dependency is
 * never tracked twice.
 */

import { isExampleId } from "@/components/tool-frame/example-data";
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
  findLinkedEdge,
  linkDependency,
  patchEdge,
  releaseEdges,
  sameRef,
  waitOf,
  type EdgeHeir,
  type MapGraph,
} from "../dependency-map/link";
import { meetingDay } from "./agenda";
import { SOS_EXAMPLE_MAP_PREFIX } from "./example";

const EMPTY: MapGraph = { nodes: [], edges: [] };
const key = (s: string | undefined) => (s ?? "").trim().toLowerCase();

export const entryRef = (e: Pick<SosEntry, "id">): HandoffRef => ({
  tool: "scrum-of-scrums",
  id: e.id,
});

/** Example entries see and draw only the example's own map nodes, never the user's. */
export const scopeOf = (e: Pick<SosEntry, "id">): string | undefined =>
  isExampleId(e.id) ? SOS_EXAMPLE_MAP_PREFIX : undefined;

/** When the entry was raised: an edge resolved before then isn't what it waits on. */
const raisedAt = (e: SosEntry): string | undefined => e.loggedAt || meetingDay(e) || undefined;

/**
 * The edge a dependency entry shows: the one it drew, else one another tool
 * drew for the same wait (`findLinkedEdge`: unresolved, or resolved since
 * the entry was raised).
 *
 * An entry resolved in its own data stays resolved: no borrowed edge is
 * matched to it, so a later dependency between the same two teams can't
 * drag it back onto the agenda. `asOpen` asks which edge it would show once
 * reopened, so Reopen can reopen that one too.
 */
export function edgeForEntry(
  map: MapGraph,
  entry: SosEntry,
  { asOpen = false }: { asOpen?: boolean } = {}
): DependencyEdge | undefined {
  if (entry.kind !== "dependency") return undefined;
  const borrow = asOpen || entry.status !== "resolved";
  return findLinkedEdge(
    map,
    entryRef(entry),
    borrow ? { from: entry.team, to: entry.blockedBy ?? "", since: raisedAt(entry) } : undefined,
    scopeOf(entry)
  );
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
 * longer a dependency (or no longer names who it waits on) lets go of its
 * own edge: it comes off the map, or passes to `heir`, another item that
 * still shows it. Edges other tools drew are left alone.
 *
 * Only a change to the team or to what it waits on moves the edge. The
 * edge's labels aren't the test: after a node is renamed on the map they
 * differ, and moving the edge then split the team into two nodes.
 */
export function syncEntryEdge(
  prev: SosEntry,
  next: SosEntry,
  heir: EdgeHeir = () => undefined
): void {
  const map = currentDependencyMap() ?? EMPTY;
  const own = map.edges.find((e) => sameRef(e.sourceRef, entryRef(prev)));
  if (!own) return;
  const waitsOn = next.blockedBy?.trim();
  if (next.kind !== "dependency" || !waitsOn) {
    releaseEdges([own.id], heir);
    return;
  }
  if (key(prev.team) === key(next.team) && key(prev.blockedBy) === key(waitsOn)) return;
  const wait = waitOf(map, own);
  if (key(wait.from) === key(next.team) && key(wait.to) === key(waitsOn)) return;
  const released = releaseEdges([own.id], heir);
  // Moved off the map with this entry: its details come along to the new pair.
  const carry = released.handed.length === 0 ? own : undefined;
  const result = linkDependency(
    {
      from: next.team,
      to: waitsOn,
      kind: "needs",
      status: carry && edgeStatus(carry) === "at-risk" ? "at-risk" : "open",
      owner: carry?.owner,
      due: carry?.due,
      note: carry?.note ?? next.text,
      sourceRef: entryRef(next),
    },
    undefined,
    scopeOf(next)
  );
  // Landed on an open edge someone else drew: fill its gaps, never drop them.
  if (result && !result.addedEdge && carry) {
    patchEdge(result.edgeId, { owner: carry.owner, due: carry.due, note: carry.note });
  }
}
