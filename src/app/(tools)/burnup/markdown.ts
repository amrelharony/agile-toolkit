import type { Sprint } from "@/lib/stores/workspace-types";
import { churnLine, type BurnSeries, type BurnStatus } from "@/lib/sprints/burn";
import { fmt } from "@/lib/sprints/hub-view";
import { dayAndDate, mdCell, mdDate, mdIsoDate, sourceLine } from "../burndown/markdown";

const OFF = { weekend: "Weekend", holiday: "Holiday" } as const;

/**
 * The burnup as Markdown, for a sprint review page or a stakeholder update:
 * the verdict, done against the current scope, how the scope grew and
 * shrank (with the days), when the work meets the scope at this pace, then
 * every day.
 */
export function burnupMarkdown(
  { sprint, burn, status }: { sprint: Sprint; burn: BurnSeries; status: BurnStatus },
  now: Date = new Date()
): string {
  const title = `# Burnup — ${mdDate(now)}`;
  const anything = burn.source !== "none" || burn.days.some((d) => d.note);
  if (!anything) {
    return `${title}\n\nNothing recorded yet: point the sprint's stories and move them on the board, or log the points done each day.\n`;
  }
  const churn = churnLine(burn);
  const lines = [
    title,
    "",
    `**Sprint:** ${mdCell(sprint.name)}: ${fmt(burn.committed)} points committed over ${
      burn.lengthDays
    } days (${burn.workingDays} working days), starting ${mdIsoDate(sprint.startDate)}`,
    `**Source:** ${sourceLine(burn.source)}`,
    "",
    status.scopeVerdict,
    "",
  ];
  if (burn.done !== null) {
    lines.push(
      `**Done:** ${fmt(burn.done)} of ${fmt(burn.scopeNow)} points${
        status.completionPct === null ? "" : ` (${status.completionPct}%)`
      }`
    );
  }
  lines.push(
    `**Scope:** ${churn.charAt(0).toUpperCase()}${churn.slice(1)} (${fmt(burn.initialScope)} → ${fmt(
      burn.scopeNow
    )})`,
    `**Projected done:** ${
      status.cantTell
        ? "Can't tell yet (open stories have no points)"
        : status.projectedMeetDay === null
          ? "No trend yet"
          : `${dayAndDate(sprint, status.projectedMeetDay)}${
              status.willMeetOnTime === false ? ", after the last day" : ""
            }`
    }`
  );

  const moves = burn.days.filter((d) => d.added > 0 || d.removed > 0);
  if (moves.length > 0) {
    lines.push(
      "",
      "## Scope added and removed",
      "",
      ...moves.map((d) => {
        const parts = [
          d.added > 0 ? `+${fmt(d.added)} added` : "",
          d.removed > 0 ? `−${fmt(d.removed)} removed` : "",
        ].filter(Boolean);
        return `- Day ${d.day}: ${parts.join(", ")}${d.note ? ` (${mdCell(d.note)})` : ""}`;
      })
    );
  }

  lines.push(
    "",
    "## Daily data",
    "",
    "| Day | Date | Day off | Scope | Done | Added | Removed | Note |",
    "|---:|---|---|---:|---:|---:|---:|---|",
    ...burn.days.map(
      (d) =>
        `| ${d.day} | ${d.date ? mdIsoDate(d.date) : ""} | ${d.off ? OFF[d.off] : ""} | ${
          d.scope === null ? "—" : fmt(d.scope)
        } | ${d.done === null ? "—" : fmt(d.done)} | ${d.added ? fmt(d.added) : ""} | ${
          d.removed ? fmt(d.removed) : ""
        } | ${mdCell(d.note)} |`
    )
  );
  return `${lines.join("\n")}\n`;
}
