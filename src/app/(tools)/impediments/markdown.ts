import type { Impediment, KanbanCard, Story } from "@/lib/stores/workspace-types";
import { blockedWorkSentence, lastDays, readBlockers } from "@/lib/impediments/blockers";
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

/** What the Blockers section reads besides the impediments. */
export interface MarkdownBlockers {
  stories: readonly Story[];
  cards: readonly KanbanCard[];
  /** Now in ms (for spells still open). */
  now: number;
}

const SIDE = { internal: "Inside", external: "Outside" } as const;

/** "## Blockers (last 90 days)": the clusters, the split and the blocked-work line, or nothing. */
function blockersSection(
  list: readonly Impediment[],
  today: string,
  b: MarkdownBlockers
): string[] {
  const read = readBlockers(b.stories, b.cards, list, lastDays(90, today, b.now), {
    includeExamples: true,
  });
  if (read.rows.length === 0) return [];
  const byDays = read.pareto.measure === "blocked_days";
  const lines = ["", "## Blockers (last 90 days)", ""];
  if (read.pareto.sentence) lines.push(read.pareto.sentence, "");
  if (read.pareto.clusters.length > 0) {
    lines.push(
      "| Cluster | Inside/outside | Blocked days | Impediments | Share |",
      "|---|---|---:|---:|---:|",
      ...read.pareto.clusters.map(
        (c) =>
          `| ${md(c.cluster)} | ${SIDE[c.side]} | ${c.blockedDays} | ${c.impediments} | ${Math.round(c.share * 100)}% |`
      ),
      ""
    );
  }
  if (read.split.externalPct !== null) {
    const what = byDays ? "blocked days" : "impediments raised";
    lines.push(`Outside the team: ${read.split.externalPct}% of ${what}.`);
  }
  lines.push(
    read.blockedWork
      ? blockedWorkSentence(read.blockedWork)
      : `Blocked time counts from ${dayLabel(read.trackingSince, true)}.`
  );
  if (read.unclustered.length > 0) lines.push(`${read.unclustered.length} not clustered yet.`);
  return lines;
}

/**
 * The tracker for a standup thread, a retro or a status report: the
 * verdict, then escalated, open and resolved sections in the page's order,
 * with age, owner and due date. Empty sections are left out. With
 * `blockers` (the stories and the Flow board's cards) and a blocker in the
 * last 90 days, a "Blockers" section follows: the clusters, inside against
 * outside, and how blocked time hit finished work.
 */
export function toMarkdown(
  list: readonly Impediment[],
  today: string,
  blockers?: MarkdownBlockers
): string {
  const title = `# Impediments — ${dayLabel(today, true)}`;
  if (list.length === 0) {
    // Blocked stories and cards count before any impediment is logged.
    const lines = [title, "", "No impediments logged yet."];
    if (blockers) lines.push(...blockersSection(list, today, blockers));
    return `${lines.join("\n")}\n`;
  }

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
  if (blockers) lines.push(...blockersSection(list, today, blockers));
  return `${lines.join("\n")}\n`;
}
