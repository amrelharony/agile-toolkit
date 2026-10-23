import type { DependencyMap, ISODateString } from "@/lib/stores/workspace-types";
import { DEPENDENCY_STATUS_LABEL } from "@/lib/dependencies/edges";
import { dayLabel } from "../dependency-map/format";
import { capacityOf, cellLoad, dependencyView, dependencyViews, teamLoad } from "./load";
import type { PiItem, PiState } from "./store";
import { piVerdict } from "./verdict";

type Graph = Pick<DependencyMap, "nodes" | "edges">;

/** A table cell: one line, pipes escaped. */
function md(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

const pts = (n: number) => `${n} ${n === 1 ? "pt" : "pts"}`;

function itemLine(item: PiItem, map: Graph, today: ISODateString): string {
  const size = item.points === undefined ? "not sized" : pts(item.points);
  if (item.kind === "feature") return `${md(item.title)} (${size})`;
  if (item.kind === "risk") return `Risk: ${md(item.title)}`;
  const v = dependencyView(map, item, today);
  const status = v.status
    ? `${DEPENDENCY_STATUS_LABEL[v.status]}${v.overdue ? ", overdue" : ""}`
    : "not on the map";
  return `Dependency: ${md(item.title)}, waits on ${md(v.waitsOn) || "?"} (${status})`;
}

/**
 * The board as Markdown for the PI readout: the verdict, load against
 * capacity per team, each team's iterations, the objectives with business
 * value, and the dependencies with their live status.
 */
export function toMarkdown(state: PiState, map: Graph, today: ISODateString): string {
  const title = `# PI Planning — ${dayLabel(today, true)}`;
  if (state.teams.length === 0) return `${title}\n\nNo teams on the board yet.\n`;
  const lines = [title, "", `**${piVerdict(state, map, today)}**`, ""];

  lines.push(
    "## Load vs capacity",
    "",
    "| Team | Planned | Capacity | Load |",
    "|---|---:|---:|---:|",
    ...state.teams.map((t) => {
      const l = teamLoad(state, t);
      return `| ${md(t.name)} | ${l.planned}${l.unsized ? ` (+${l.unsized} not sized)` : ""} | ${
        l.capacity ?? "—"
      } | ${l.pct === null ? "—" : `${l.pct}%`} |`;
    }),
    ""
  );

  lines.push("## Board", "");
  for (const t of state.teams) {
    const cap = capacityOf(t);
    lines.push(`### ${md(t.name)}${cap ? ` (${pts(cap)} per iteration)` : ""}`, "");
    for (let it = 0; it < state.iterations; it++) {
      const items = state.items.filter((i) => i.teamId === t.id && i.iteration === it);
      const load = cellLoad(state, t, it);
      const head = `- Iteration ${it + 1}${cap ? ` (${load.planned} / ${cap} pts${load.over ? ", over capacity" : ""})` : ""}`;
      lines.push(
        items.length
          ? `${head}: ${items.map((i) => itemLine(i, map, today)).join("; ")}`
          : `${head}: nothing planned`
      );
    }
    lines.push("");
  }

  const objectives = state.objectives ?? [];
  if (objectives.length > 0) {
    const team = (id: string) => state.teams.find((t) => t.id === id)?.name ?? "";
    lines.push(
      "## PI objectives",
      "",
      "| Team | Objective | Business value | Commitment |",
      "|---|---|---:|---|",
      ...objectives.map(
        (o) =>
          `| ${md(team(o.teamId))} | ${md(o.title)} | ${o.businessValue ?? "Not scored"} | ${
            o.committed ? "Committed" : "Uncommitted"
          } |`
      ),
      ""
    );
  }

  const deps = dependencyViews(state, map, today);
  if (deps.length > 0) {
    const team = (id: string) => state.teams.find((t) => t.id === id)?.name ?? "";
    lines.push(
      "## Dependencies",
      "",
      "| Team | Item | Waits on | Status | Due |",
      "|---|---|---|---|---|",
      ...deps.map((d) => {
        const status = d.status
          ? `${DEPENDENCY_STATUS_LABEL[d.status]}${d.overdue ? " (overdue)" : ""}`
          : "Not on the map";
        return `| ${md(team(d.item.teamId))} | ${md(d.item.title)} | ${md(d.waitsOn) || "—"} | ${status} | ${
          d.edge?.due ? dayLabel(d.edge.due, true) : "—"
        } |`;
      }),
      ""
    );
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
