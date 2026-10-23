/**
 * PI dependency items on the one dependency model.
 *
 * A dependency item names the team it waits on; the edge "this team needs
 * that team" lives on the Dependency Map, and the item stores only the
 * edge's id. Status, owner and due date are read from and written to the
 * edge, so resolving it here, on the map or from Scrum of Scrums shows the
 * same everywhere. An edge the item drew itself (its `sourceRef` points
 * here) moves with the item; an edge someone else drew that the item
 * reused is never removed from here. When the item that drew a shared edge
 * lets go of it, the edge passes to whoever else still shows it.
 */

import { isExampleId } from "@/components/tool-frame/example-data";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { DependencyEdge, HandoffRef } from "@/lib/stores/workspace-types";
import { edgeStatus } from "@/lib/dependencies/edges";
import {
  currentDependencyMap,
  edgeById,
  edgeSides,
  linkDependency,
  nodeInScope,
  patchEdge,
  releaseEdges,
  sameRef,
  updateDependencyMap,
  type EdgeHeir,
  type MapGraph,
} from "../dependency-map/link";
import { edgeForEntry, entryRef } from "../scrum-of-scrums/links";
import { EXAMPLE_MAP_PREFIX } from "./example";
import type { PiItem } from "./store";

const EMPTY: MapGraph = { nodes: [], edges: [] };
const key = (s: string | undefined) => (s ?? "").trim().toLowerCase();

export const itemRef = (item: Pick<PiItem, "id">): HandoffRef => ({
  tool: "pi-planning",
  id: item.id,
});

/** Example items link among the example's own map nodes; the user's items never touch those. */
export const scopeOf = (item: Pick<PiItem, "id">): string | undefined =>
  isExampleId(item.id) ? EXAMPLE_MAP_PREFIX : undefined;

/** The edge this item drew, while it's still on the map. */
export function ownEdge(item: PiItem): DependencyEdge | undefined {
  const edge = edgeById(currentDependencyMap() ?? EMPTY, item.edgeId);
  return edge && sameRef(edge.sourceRef, itemRef(item)) ? edge : undefined;
}

/**
 * Who still shows an edge once the `leaving` items let go of it: another
 * dependency item on the board linked to it, else a Scrum of Scrums entry
 * showing it for the same wait. That one inherits the edge.
 */
export function boardHeir(items: readonly PiItem[], leaving: ReadonlySet<string>): EdgeHeir {
  return (edge) => {
    const item = items.find(
      (i) => !leaving.has(i.id) && i.kind === "dependency" && i.edgeId === edge.id
    );
    if (item) return itemRef(item);
    const map = currentDependencyMap() ?? EMPTY;
    const entry = (useWorkspaceStore.getState().sosEntries ?? []).find(
      (e) => edgeForEntry(map, e)?.id === edge.id
    );
    return entry ? entryRef(entry) : undefined;
  };
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
 * - Team and waits-on unchanged in this edit: keep the edge (and set the
 *   due date). The edge's labels aren't the test: after a node is renamed
 *   on the map they differ, and re-linking then split the team in two.
 * - Different sides: link the new pair; an edge this item drew is moved
 *   (its owner, due date, note and at-risk flag come along), never
 *   duplicated, unless another item still shows it (`heir`), which keeps it.
 * - Linking onto an open edge that was already there: that edge gets the
 *   due date just typed, and fills its gaps from the edge moved off.
 * - No longer a dependency: an edge this item drew comes off the map, or
 *   passes to its heir.
 */
export function syncDependencyEdge(
  prev: PiItem | null,
  next: PiItem,
  sides: DependencySides,
  heir: EdgeHeir = () => undefined
): string | undefined {
  const map = currentDependencyMap() ?? EMPTY;
  const old = prev ? edgeById(map, prev.edgeId) : undefined;
  const mine = Boolean(old && prev && sameRef(old.sourceRef, itemRef(prev)));
  if (next.kind !== "dependency") {
    if (old && mine) releaseEdges([old.id], heir);
    return undefined;
  }
  // A team can't wait on itself; never draw an edge the map would hide.
  if (key(sides.teamName) === key(sides.dependsOn)) return old?.id;
  if (old) {
    const current = edgeSides(map, old);
    const sameTeam = prev?.teamId === next.teamId || key(current.from) === key(sides.teamName);
    const sameOther =
      key(current.to) === key(sides.dependsOn) || key(prev?.dependsOn) === key(sides.dependsOn);
    if (sameTeam && sameOther) {
      if (sides.due !== undefined && (sides.due ?? undefined) !== old.due) {
        setEdgeDue(old.id, sides.due ?? undefined);
      }
      return old.id;
    }
  }
  const released = old && mine ? releaseEdges([old.id], heir) : undefined;
  // Moved off the map with this item: its details come along to the new pair.
  const carry = released && released.handed.length === 0 ? old : undefined;
  const due = sides.due === undefined ? carry?.due : (sides.due ?? undefined);
  const result = linkDependency(
    {
      from: sides.teamName,
      to: sides.dependsOn,
      kind: "needs",
      status: carry && edgeStatus(carry) === "at-risk" ? "at-risk" : "open",
      owner: carry?.owner,
      due,
      note: carry?.note ?? sides.title,
      sourceRef: itemRef(next),
    },
    undefined,
    scopeOf(next)
  );
  if (!result) return undefined;
  if (!result.addedEdge) {
    patchEdge(
      result.edgeId,
      { owner: carry?.owner, due, note: carry?.note },
      sides.due ? ["due"] : []
    );
  }
  return result.edgeId;
}

/**
 * A team was renamed on the board: rename its node on the map too, so its
 * dependencies keep showing under the new name (Scrum of Scrums finds a
 * team by name) and the next edit doesn't split the team into two nodes.
 * The node is the one the team's linked dependencies wait from. When the
 * map already has a node with the new name, the edges this team's items
 * drew move onto that one instead.
 */
export function renameTeamOnMap(
  items: readonly PiItem[],
  teamId: string,
  from: string,
  to: string
): void {
  const name = to.trim();
  const linked = items.filter((i) => i.teamId === teamId && i.kind === "dependency" && i.edgeId);
  if (!name || name === from.trim() || linked.length === 0) return;
  updateDependencyMap((map) => {
    const edges = map.edges.filter((e) => linked.some((i) => i.edgeId === e.id));
    const node = map.nodes.find(
      (n) => key(n.label) === key(from) && edges.some((e) => e.from === n.id)
    );
    if (!node) return map;
    const scope = nodeInScope(
      node.id.startsWith(EXAMPLE_MAP_PREFIX) ? EXAMPLE_MAP_PREFIX : undefined
    );
    const clash = map.nodes.find((n) => n.id !== node.id && scope(n) && key(n.label) === key(name));
    if (!clash) {
      return {
        nodes: map.nodes.map((n) => (n.id === node.id ? { ...n, label: name } : n)),
        edges: map.edges,
      };
    }
    const own = new Set(
      edges
        .filter((e) => linked.some((i) => i.edgeId === e.id && sameRef(e.sourceRef, itemRef(i))))
        .map((e) => e.id)
    );
    return {
      nodes: map.nodes,
      edges: map.edges.map((e) =>
        own.has(e.id) && e.from === node.id && e.to !== clash.id ? { ...e, from: clash.id } : e
      ),
    };
  });
}
