/**
 * PI dependency items on the one dependency model.
 *
 * A dependency item names the team it waits on; the edge "this team needs
 * that team" lives on the Dependency Map, and the item stores only the
 * edge's id. Status, owner and due date are read from and written to the
 * edge, so resolving it here, on the map or from Scrum of Scrums shows the
 * same everywhere. An edge the item drew itself (its `sourceRef` points
 * here) moves with the item; an edge someone else drew that the item
 * reused is never removed from here.
 */

import type { DependencyEdge, HandoffRef } from "@/lib/stores/workspace-types";
import { edgeStatus } from "@/lib/dependencies/edges";
import {
  currentDependencyMap,
  edgeById,
  edgeSides,
  linkDependency,
  sameRef,
  takeEdges,
  updateDependencyMap,
  type MapGraph,
} from "../dependency-map/link";
import type { PiItem } from "./store";

const EMPTY: MapGraph = { nodes: [], edges: [] };
const key = (s: string) => s.trim().toLowerCase();

export const itemRef = (item: Pick<PiItem, "id">): HandoffRef => ({
  tool: "pi-planning",
  id: item.id,
});

/** The edge this item drew, while it's still on the map. */
export function ownEdge(item: PiItem): DependencyEdge | undefined {
  const edge = edgeById(currentDependencyMap() ?? EMPTY, item.edgeId);
  return edge && sameRef(edge.sourceRef, itemRef(item)) ? edge : undefined;
}

function setEdgeDue(id: string, due: string | undefined): void {
  updateDependencyMap((map) => ({
    nodes: map.nodes,
    edges: map.edges.map((e) => {
      if (e.id !== id) return e;
      const next = { ...e };
      if (due) next.due = due;
      else delete next.due;
      return next;
    }),
  }));
}

export interface DependencySides {
  /** The waiting side: the item's team. */
  teamName: string;
  /** The side it waits on. */
  dependsOn: string;
  /** The item's title, the edge's note when the item draws it. */
  title: string;
  /** Undefined keeps the edge's due date; null clears it; a date sets it. */
  due?: string | null;
}

/**
 * Keep an item's edge in step after it is added, edited or moved, and
 * return the edge id to store on the item (undefined when it no longer is
 * a dependency).
 *
 * - Same two sides as the linked edge: keep it (and set the due date).
 * - Different sides: link the new pair; an edge this item drew is moved
 *   (its owner, due date, note and at-risk flag come along), never
 *   duplicated.
 * - No longer a dependency: an edge this item drew comes off the map.
 */
export function syncDependencyEdge(
  prev: PiItem | null,
  next: PiItem,
  sides: DependencySides
): string | undefined {
  const map = currentDependencyMap() ?? EMPTY;
  const old = prev ? edgeById(map, prev.edgeId) : undefined;
  const mine = Boolean(old && prev && sameRef(old.sourceRef, itemRef(prev)));
  if (next.kind !== "dependency") {
    if (old && mine) takeEdges([old.id]);
    return undefined;
  }
  if (old) {
    const current = edgeSides(map, old);
    if (key(current.from) === key(sides.teamName) && key(current.to) === key(sides.dependsOn)) {
      if (sides.due !== undefined && (sides.due ?? undefined) !== old.due) {
        setEdgeDue(old.id, sides.due ?? undefined);
      }
      return old.id;
    }
  }
  const carry = old && mine ? old : undefined;
  if (carry) takeEdges([carry.id]);
  const due = sides.due === undefined ? carry?.due : (sides.due ?? undefined);
  return linkDependency({
    from: sides.teamName,
    to: sides.dependsOn,
    kind: "needs",
    status: carry && edgeStatus(carry) === "at-risk" ? "at-risk" : "open",
    owner: carry?.owner,
    due,
    note: carry?.note ?? sides.title,
    sourceRef: itemRef(next),
  }).edgeId;
}
