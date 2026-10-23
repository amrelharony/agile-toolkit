import type { DependencyMap, ISODateString } from "@/lib/stores/workspace-types";
import { fmt, listAnd, plural } from "@/lib/charts/chart-text";
import { dependencyViews, overloads, teamLoad } from "./load";
import type { PiState } from "./store";

type Graph = Pick<DependencyMap, "nodes" | "edges">;

/**
 * The one-sentence answer above the board: planned against capacity, which
 * cells are over, and how many dependencies are still open.
 *
 *   "3 teams plan 120 feature points against a capacity of 375 (32%); over
 *    capacity: Checkout in iteration 2; 2 open dependencies (1 overdue)."
 */
export function piVerdict(state: PiState, map: Graph, today: ISODateString): string {
  const teams = state.teams;
  if (teams.length === 0) return "No teams on the board yet.";
  const loads = teams.map((t) => teamLoad(state, t));
  const planned = loads.reduce((a, l) => a + l.planned, 0);
  const withCapacity = loads.filter((l) => l.capacity !== null);
  const capacity = withCapacity.reduce((a, l) => a + (l.capacity as number), 0);

  let text = `${plural(teams.length, "team")} plan ${fmt(planned)} feature ${planned === 1 ? "point" : "points"}`;
  if (withCapacity.length === teams.length) {
    text += ` against a capacity of ${fmt(capacity)} (${Math.round((planned / capacity) * 100)}%)`;
  } else if (withCapacity.length === 0) {
    text += ", with no velocity set yet";
  } else {
    const missing = teams.length - withCapacity.length;
    text += ` (${plural(missing, "team")} without a velocity yet)`;
  }

  const over = overloads(state);
  if (over.length > 0) {
    const name = (id: string) => teams.find((t) => t.id === id)?.name ?? "A team";
    const named = over.slice(0, 2).map((o) => `${name(o.teamId)} in iteration ${o.iteration + 1}`);
    if (over.length > 2) named.push(`${over.length - 2} more`);
    text += `; over capacity: ${listAnd(named)}`;
  } else if (withCapacity.length > 0) {
    text += "; no team is over capacity";
  }

  const deps = dependencyViews(state, map, today);
  const open = deps.filter((d) => d.status !== "resolved");
  const late = deps.filter((d) => d.overdue).length;
  if (open.length > 0) {
    text += `; ${open.length} open ${open.length === 1 ? "dependency" : "dependencies"}${
      late > 0 ? ` (${late} overdue)` : ""
    }`;
  } else if (deps.length > 0) {
    text += "; every dependency is resolved";
  }
  return `${text}.`;
}
