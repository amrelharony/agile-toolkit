/**
 * PI board maths: load against capacity per cell and per team, and how the
 * board's dependency items stand on the Dependency Map.
 *
 * Plain sums on purpose. The board used to show a "P85 team velocity" from
 * a Monte Carlo over one velocity per team, which mixed different teams'
 * velocities into one distribution and answered no planning question. A
 * team's load is what it planned against what it said it can do.
 */

import type {
  DependencyEdge,
  DependencyMap,
  DependencyStatus,
  ISODateString,
} from "@/lib/stores/workspace-types";
import { edgeStatus, isOverdue } from "@/lib/dependencies/edges";
import type { PiItem, PiState, PiTeam } from "./store";

type Graph = Pick<DependencyMap, "nodes" | "edges">;

/** Points per iteration, or null when the team hasn't set one. */
export const capacityOf = (t: Pick<PiTeam, "velocity">): number | null =>
  typeof t.velocity === "number" && t.velocity > 0 ? t.velocity : null;

const sized = (i: PiItem) => typeof i.points === "number" && Number.isFinite(i.points);

export interface Load {
  /** Feature points planned. */
  planned: number;
  /** Features with no points yet: the load is a floor until they're sized. */
  unsized: number;
  capacity: number | null;
  over: boolean;
}

function loadOf(features: readonly PiItem[], capacity: number | null): Load {
  const planned = features.filter(sized).reduce((a, i) => a + (i.points as number), 0);
  return {
    planned,
    unsized: features.filter((i) => !sized(i)).length,
    capacity,
    over: capacity !== null && planned > capacity,
  };
}

const features = (state: PiState, teamId: string, iteration?: number) =>
  state.items.filter(
    (i) =>
      i.teamId === teamId &&
      i.kind === "feature" &&
      i.iteration < state.iterations &&
      (iteration === undefined || i.iteration === iteration)
  );

/** One cell: a team's features in one iteration against one iteration's capacity. */
export function cellLoad(state: PiState, team: PiTeam, iteration: number): Load {
  return loadOf(features(state, team.id, iteration), capacityOf(team));
}

/** A team across the PI: every iteration's features against velocity × iterations. */
export function teamLoad(state: PiState, team: PiTeam): Load & { pct: number | null } {
  const perIteration = capacityOf(team);
  const load = loadOf(
    features(state, team.id),
    perIteration === null ? null : perIteration * state.iterations
  );
  return {
    ...load,
    pct: load.capacity ? Math.round((load.planned / load.capacity) * 100) : null,
  };
}

export interface Overload {
  teamId: string;
  iteration: number;
  planned: number;
  capacity: number;
}

/** Cells where a team planned more than one iteration's capacity. */
export function overloads(state: PiState): Overload[] {
  return state.teams.flatMap((team) =>
    Array.from({ length: state.iterations }, (_, it) => ({ it, load: cellLoad(state, team, it) }))
      .filter(({ load }) => load.over)
      .map(({ it, load }) => ({
        teamId: team.id,
        iteration: it,
        planned: load.planned,
        capacity: load.capacity as number,
      }))
  );
}

/** A dependency item as the board shows it: the linked edge's live state, or why there is none. */
export interface DependencyView {
  item: PiItem;
  edge?: DependencyEdge;
  /** What it waits on: the edge's far side when linked, else what the item names. */
  waitsOn: string;
  /** Undefined while the item isn't on the map. */
  status?: DependencyStatus;
  overdue: boolean;
}

export function dependencyView(map: Graph, item: PiItem, today: ISODateString): DependencyView {
  const edge = item.edgeId ? map.edges.find((e) => e.id === item.edgeId) : undefined;
  const far = edge ? map.nodes.find((n) => n.id === edge.to)?.label : undefined;
  return {
    item,
    edge,
    waitsOn: far ?? item.dependsOn ?? "",
    status: edge ? edgeStatus(edge) : undefined,
    overdue: edge ? isOverdue(edge, today) : false,
  };
}

/** Every dependency item on the board's visible iterations. */
export function dependencyViews(
  state: PiState,
  map: Graph,
  today: ISODateString
): DependencyView[] {
  return state.items
    .filter((i) => i.kind === "dependency" && i.iteration < state.iterations)
    .map((i) => dependencyView(map, i, today));
}

/**
 * True when a dependency item in `teamName` would wait on its own team: the
 * Move menu can't put it in the team it waits on (the map hides a
 * self-edge, so nobody could see or remove it there).
 */
export function waitsOnTeam(view: DependencyView | undefined, teamName: string): boolean {
  const waitsOn = view?.item.kind === "dependency" ? view.waitsOn.trim().toLowerCase() : "";
  return Boolean(waitsOn) && waitsOn === teamName.trim().toLowerCase();
}

/** Dependency items saved before the map link: no edge and no named other side. */
export const isLegacyDependency = (i: PiItem) =>
  i.kind === "dependency" && !i.edgeId && !i.dependsOn?.trim();
