import type { DependencyMap, ISODateString } from "@/lib/stores/workspace-types";
import { DEPENDENCY_STATUS_LABEL, edgeStatus, isOverdue } from "@/lib/dependencies/edges";
import { dayLabel } from "./format";
import { cleanEdges, criticalPath, detectCycles } from "./graph";
import { dependencyVerdict } from "./verdict";

type Graph = Pick<DependencyMap, "nodes" | "edges">;

/** A table cell: one line, pipes escaped. */
function md(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

/**
 * The map as Markdown for a release thread or a PI sync: the verdict, every
 * dependency with its status, owner and due date, the critical path in
 * delivery order, any circular waits, and the nodes.
 */
export function toMarkdown(map: Graph, today: ISODateString): string {
  const title = `# Dependency Map — ${dayLabel(today, true)}`;
  if (map.nodes.length === 0) return `${title}\n\nNothing on the map yet.\n`;

  const label = (id: string) => map.nodes.find((n) => n.id === id)?.label ?? id;
  const edges = cleanEdges(map);
  const lines = [title, "", `**${dependencyVerdict(map, today)}**`, ""];

  if (edges.length > 0) {
    lines.push(
      "## Dependencies",
      "",
      "| From | Type | To | Status | Owner | Due | Note |",
      "|---|---|---|---|---|---|---|",
      ...edges.map((e) => {
        const status = DEPENDENCY_STATUS_LABEL[edgeStatus(e)];
        const due = e.due
          ? `${dayLabel(e.due, true)}${isOverdue(e, today) ? " (overdue)" : ""}`
          : "—";
        return `| ${md(label(e.from))} | ${e.kind} | ${md(label(e.to))} | ${status} | ${md(e.owner) || "—"} | ${due} | ${md(e.note) || "—"} |`;
      }),
      ""
    );
  }

  const cycles = detectCycles(map.nodes, edges);
  if (cycles.length > 0) {
    lines.push(
      "## Circular waits",
      "",
      ...cycles.map((c) => `- ${c.map(label).map(md).join(" → ")}`),
      "",
      "No critical path while a circular wait exists.",
      ""
    );
  } else {
    const path = criticalPath(map.nodes, edges, today);
    if (path.steps.length > 0) {
      lines.push(
        `## Critical path (${path.steps.length} ${path.steps.length === 1 ? "link" : "links"})`,
        "",
        ...path.steps.map((s, i) => {
          const flags = [
            s.overdue && "overdue",
            s.atRisk && "at risk",
            s.dueBeforeUpstream && "due before the link it waits on",
          ].filter(Boolean);
          const due = s.edge.due ? `, due ${dayLabel(s.edge.due, true)}` : ", no due date";
          return `${i + 1}. ${md(label(s.provider))} → ${md(label(s.consumer))}${due}${
            flags.length ? ` (${flags.join(", ")})` : ""
          }`;
        }),
        ""
      );
    }
  }

  lines.push(
    "## Nodes",
    "",
    ...map.nodes.map(
      (n) =>
        `- ${md(n.label)}${n.team ? ` (${md(n.team)})` : ""}${n.description ? `: ${md(n.description)}` : ""}`
    )
  );
  return `${lines.join("\n")}\n`;
}
