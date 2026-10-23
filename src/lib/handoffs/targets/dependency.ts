/**
 * Hand-off target: a dependency.
 *
 * Dependencies live on the Dependency Map's graph (`dependency-map:current`,
 * the one dependency model; see lib/dependencies/edges). This route sends a
 * single item there: it becomes a node, labelled with its title, its owner
 * as the team. When the source names what it waits on (`dependsOn`), that
 * side is found by label, or added, and a "needs" edge joins the two. The
 * node and anything the send added keep `sourceRef`, so Undo takes back
 * exactly what this send put there. (PI Planning and Scrum of Scrums link
 * team → team edges directly, through dependency-map/link.ts.)
 */

import { nanoid } from "nanoid";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  DependencyEdge,
  DependencyMap,
  DependencyNode,
  HandoffRef,
} from "@/lib/stores/workspace-types";
import type { HandoffRoute, HandoffSource } from "../types";

/** MUST match DM_ID in dependency-map-client.tsx and src/lib/actions/tools/dependency-map.ts. */
export const DEPENDENCY_MAP_ID = "dependency-map:current";

/** The Dependency Map's own caps. */
const LABEL_MAX = 240;
const TEAM_MAX = 120;
const DESCRIPTION_MAX = 2000;

export function currentDependencyMap(): DependencyMap | undefined {
  return (useWorkspaceStore.getState().dependencyMaps ?? []).find(
    (d) => d.id === DEPENDENCY_MAP_ID
  );
}

function save(map: Omit<DependencyMap, "id">): void {
  useWorkspaceStore.getState().upsertDependencyMap({ ...map, id: DEPENDENCY_MAP_ID });
}

const labelKey = (label: string) => label.trim().toLowerCase();

const sameRef = (a: HandoffRef | undefined, b: HandoffRef | undefined) =>
  Boolean(a && b && a.tool === b.tool && a.id === b.id && a.doc === b.doc);

/** The graph after sending `src`: its node, and the edge to what it waits on. */
export function withDependency(
  map: Pick<DependencyMap, "nodes" | "edges"> | undefined,
  src: HandoffSource,
  id = nanoid(6)
): { nodes: DependencyNode[]; edges: DependencyEdge[] } {
  const nodes = [...(map?.nodes ?? [])];
  const edges = [...(map?.edges ?? [])];
  const team = (src.owner ?? src.raisedBy ?? "").trim().slice(0, TEAM_MAX);
  const description = (src.description ?? "").trim().slice(0, DESCRIPTION_MAX);
  nodes.push({
    id,
    label: src.title.trim().slice(0, LABEL_MAX),
    ...(team ? { team } : {}),
    ...(description ? { description } : {}),
    sourceRef: src.sourceRef,
  });
  const other = (src.dependsOn ?? "").trim().slice(0, LABEL_MAX);
  if (other) {
    let target = nodes.find((n) => n.id !== id && labelKey(n.label) === labelKey(other));
    if (!target) {
      target = { id: `${id}-on`, label: other, sourceRef: src.sourceRef };
      nodes.push(target);
    }
    edges.push({
      id: `${id}-needs`,
      from: id,
      to: target.id,
      kind: "needs",
      sourceRef: src.sourceRef,
    });
  }
  return { nodes, edges };
}

/** The graph without the node `id`, its edges, and a node this send added that nothing else uses. */
export function withoutDependency(
  map: Pick<DependencyMap, "nodes" | "edges">,
  id: string
): { nodes: DependencyNode[]; edges: DependencyEdge[] } {
  const node = map.nodes.find((n) => n.id === id);
  const edges = map.edges.filter((e) => e.from !== id && e.to !== id);
  const added = new Set(
    map.nodes
      .filter(
        (n) =>
          n.id === `${id}-on` &&
          sameRef(n.sourceRef, node?.sourceRef) &&
          !edges.some((e) => e.from === n.id || e.to === n.id)
      )
      .map((n) => n.id)
  );
  return { nodes: map.nodes.filter((n) => n.id !== id && !added.has(n.id)), edges };
}

const findNode = (id: string) => currentDependencyMap()?.nodes.find((n) => n.id === id);

export const dependencyRoute: HandoffRoute = {
  id: "dependency",
  label: "Dependency",
  doneLabel: "Added to the Dependency Map",
  targetToolId: "dependency-map",
  targetHref: () => "/dependency-map",
  send: (src) => {
    const id = nanoid(6);
    save(withDependency(currentDependencyMap(), src, id));
    return id;
  },
  remove: (id) => {
    const map = currentDependencyMap();
    if (!map || !map.nodes.some((n) => n.id === id)) return;
    save(withoutDependency(map, id));
  },
  exists: (id) => Boolean(findNode(id)),
};
