import type { Impediment } from "@/lib/stores/workspace-types";
import {
  IMPEDIMENT_STATUS_LABEL,
  daysOverdue,
  impedimentAgeDays,
  impedimentDueDate,
  impedimentStatus,
  sortImpediments,
  type ImpedimentStatus,
} from "@/lib/impediments/model";
import { NO_VALUE } from "@/lib/charts/chart-text";
import { categoryLabel, dayLabel, daysText, severityLabel, titleOf } from "./helpers";
import { impedimentVerdict } from "./verdict";

/** A table cell: one line, pipes escaped. */
function md(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

const orDash = (v: string | undefined) => md(v) || NO_VALUE;

/** "31 Oct", "21 Oct, overdue by 3 days", or "—". */
function dueCell(i: Impediment, today: string): string {
  const due = impedimentDueDate(i);
  if (!due) return NO_VALUE;
  const late = daysOverdue(i, today);
  return late > 0 ? `${dayLabel(due)}, overdue by ${daysText(late)}` : dayLabel(due);
}

const ageCell = (i: Impediment, today: string) => {
  const age = impedimentAgeDays(i, today);
  return age === null ? NO_VALUE : daysText(age);
};

function unresolvedTable(rows: readonly Impediment[], today: string): string[] {
  return [
    "| Impediment | Severity | Category | Owner | Raised | Age | Due |",
    "|---|---|---|---|---|---:|---|",
    ...rows.map(
      (i) =>
        `| ${md(titleOf(i))} | ${md(severityLabel(i.severity))} | ${md(categoryLabel(i.category))} | ${orDash(
          i.owner
        )} | ${dayLabel(i.raisedAt)} | ${ageCell(i, today)} | ${dueCell(i, today)} |`
    ),
  ];
}

function resolvedTable(rows: readonly Impediment[], today: string): string[] {
  return [
    "| Impediment | Severity | Category | Owner | Raised | Resolved | Took |",
    "|---|---|---|---|---|---|---:|",
    ...rows.map(
      (i) =>
        `| ${md(titleOf(i))} | ${md(severityLabel(i.severity))} | ${md(categoryLabel(i.category))} | ${orDash(
          i.owner
        )} | ${dayLabel(i.raisedAt)} | ${dayLabel(i.resolvedAt)} | ${ageCell(i, today)} |`
    ),
  ];
}

const SECTIONS: readonly ImpedimentStatus[] = ["escalated", "open", "resolved"];

/**
 * The tracker for a standup thread, a retro or a status report: the
 * verdict, then escalated, open and resolved sections in the page's order,
 * with age, owner and due date. Empty sections are left out.
 */
export function toMarkdown(list: readonly Impediment[], today: string): string {
  const title = `# Impediments — ${dayLabel(today, true)}`;
  if (list.length === 0) return `${title}\n\nNo impediments logged yet.\n`;

  const sorted = sortImpediments(list, today);
  const lines = [title, "", `**${impedimentVerdict(list, today)}**`];
  for (const status of SECTIONS) {
    const rows = sorted.filter((i) => impedimentStatus(i) === status);
    if (rows.length === 0) continue;
    lines.push(
      "",
      `## ${IMPEDIMENT_STATUS_LABEL[status]} (${rows.length})`,
      "",
      ...(status === "resolved" ? resolvedTable(rows, today) : unresolvedTable(rows, today))
    );
  }
  return `${lines.join("\n")}\n`;
}
