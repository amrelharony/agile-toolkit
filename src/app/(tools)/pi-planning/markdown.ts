import type { DependencyMap, ISODateString } from "@/lib/stores/workspace-types";
import { DEPENDENCY_STATUS_LABEL } from "@/lib/dependencies/edges";
import { dayLabel } from "../dependency-map/format";
import {
  averageText,
  confidenceRule,
  confidenceVotes,
  scopeLabel,
} from "@/lib/pi-planning/confidence";
import { localDayOf } from "@/lib/pi-planning/model";
import {
  HISTORY_AVERAGE_MIN,
  historyAverage,
  piPredictability,
  predictabilityVerdict,
  recordPct,
  teamPctText,
} from "@/lib/pi-planning/predictability";
import {
  ROAM_GROUPS,
  ROAM_GROUP_LABEL,
  piRisks,
  roamGroups,
  roamVerdict,
} from "@/lib/pi-planning/roam";
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
  if (state.teams.length === 0) {
    // Removing a team keeps its votes and closed PIs, so they still export.
    const kept = [...confidenceLines(state), ...predictabilityLines(state)];
    return `${[title, "", "No teams on the board yet.", "", ...kept].join("\n").trimEnd()}\n`;
  }
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

  lines.push(...roamLines(state), ...confidenceLines(state), ...predictabilityLines(state));
  return `${lines.join("\n").trimEnd()}\n`;
}

const teamOf = (state: PiState, id: string) => state.teams.find((t) => t.id === id)?.name ?? "";

/** The risks by ROAM status, when the board has any. */
function roamLines(state: PiState): string[] {
  const risks = piRisks(state);
  if (risks.length === 0) return [];
  const groups = roamGroups(state);
  return [
    "## Risks (ROAM)",
    "",
    roamVerdict(state),
    "",
    "| Status | Risk | Team | Owner | Note |",
    "|---|---|---|---|---|",
    ...ROAM_GROUPS.flatMap((g) =>
      groups[g].map(
        (r) =>
          `| ${ROAM_GROUP_LABEL[g]} | ${md(r.title)} | ${md(teamOf(state, r.teamId))} | ${
            md(r.roamOwner) || "—"
          } | ${md(r.roamNote) || "—"} |`
      )
    ),
    "",
  ];
}

/** Each saved confidence vote's totals, newest first, when there are any. */
function confidenceLines(state: PiState): string[] {
  const votes = confidenceVotes(state);
  if (votes.length === 0) return [];
  return [
    "## Confidence vote",
    "",
    "| Saved | For | Votes | Average | 1 | 2 | 3 | 4 | 5 | Under 3 |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---|",
    ...[...votes]
      .reverse()
      .map(
        (v) =>
          `| ${dayLabel(localDayOf(v.at), true)} | ${md(scopeLabel(state, v.scope, v.scopeName))} | ${
            v.ballots
          } | ${averageText(v.counts)} | ${v.counts.join(" | ")} | ${md(confidenceRule(v.counts))} |`
      ),
    "",
  ];
}

/** Planned against actual business value per team, and the closed PIs, when there's any. */
function predictabilityLines(state: PiState): string[] {
  const p = piPredictability(state);
  const history = state.history ?? [];
  const planned = p.teams.some((t) => t.plannedBv > 0 || t.actualBv > 0);
  if (!planned && history.length === 0) return [];
  const out = ["## Predictability", ""];
  // With no teams the page already says so: only the closed PIs follow.
  if (p.teams.length > 0) out.push(predictabilityVerdict(p), "");
  if (planned) {
    out.push(
      "| Team | Planned BV | Actual BV | Predictability |",
      "|---|---:|---:|---:|",
      ...p.teams.map(
        (t) => `| ${md(t.name)} | ${t.plannedBv} | ${t.actualBv} | ${md(teamPctText(t))} |`
      ),
      ...(p.total && p.total.teams > 1
        ? [`| Train | ${p.total.plannedBv} | ${p.total.actualBv} | ${p.total.pct}% |`]
        : []),
      ""
    );
  }
  if (history.length > 0) {
    const avg = historyAverage(history);
    out.push(
      "### Closed PIs",
      "",
      "| PI | Closed | Planned BV | Actual BV | Predictability |",
      "|---|---|---:|---:|---:|",
      ...[...history].reverse().map((r) => {
        const pct = recordPct(r);
        const sum = (k: "plannedBv" | "actualBv") => r.teams.reduce((a, t) => a + t[k], 0);
        return `| ${md(r.name) || "—"} | ${dayLabel(localDayOf(r.closedAt), true)} | ${sum(
          "plannedBv"
        )} | ${sum("actualBv")} | ${pct === null ? "—" : `${pct}%`} |`;
      }),
      "",
      avg
        ? `Average over ${avg.count} closed PIs: ${avg.pct}%.`
        : `The average shows once ${HISTORY_AVERAGE_MIN} PIs are closed.`,
      ""
    );
  }
  return out;
}
