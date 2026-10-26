import { URGENT_WITHIN_DAYS, dueText } from "@/lib/prioritization/methods/eisenhower";
import type { RankedRow } from "@/lib/prioritization/rank";
import { UNSORTED, eisGroups } from "./model";
import { eisVerdict } from "./verdict";

/** "26 Oct 2026" */
function mdDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** A table cell: one line, pipes escaped. */
function md(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

/**
 * The matrix as Markdown, for a planning note or a 1:1: the rule, one
 * table per quadrant in Do, Schedule, Delegate, Delete order (due soonest
 * first as shown), the tasks still to sort, and the verdict.
 */
export function toMarkdown(
  rows: readonly RankedRow[],
  today: string,
  now: Date = new Date()
): string {
  const title = `# Eisenhower Matrix — ${mdDate(now)}`;
  if (rows.length === 0) return `${title}\n\nNo tasks yet.\n`;
  const lines = [
    title,
    "",
    `A task is urgent when you say so or when it's due within ${URGENT_WITHIN_DAYS} days (overdue included); important when it moves a goal.`,
  ];
  for (const g of eisGroups(rows, today)) {
    if (g.id === UNSORTED) {
      if (g.tasks.length === 0) continue;
      lines.push("", `## ${g.label} (${g.tasks.length})`, "");
      for (const t of g.tasks) lines.push(`- ${md(t.ranked.row.title)}`);
      continue;
    }
    lines.push("", `## ${g.label} (${g.tasks.length})`, "", g.meaning, "");
    if (g.tasks.length === 0) {
      lines.push("None.");
      continue;
    }
    lines.push("| Task | Due | Delegate to |", "|---|---|---|");
    for (const t of g.tasks) {
      const due =
        t.dueAt && t.urgency.daysToDue !== null
          ? `${t.dueAt} (${dueText(t.urgency.daysToDue)})`
          : "—";
      lines.push(`| ${md(t.ranked.row.title)} | ${md(due)} | ${md(t.delegateTo ?? "—")} |`);
    }
  }
  lines.push("", `**${eisVerdict(rows, today)}**`);
  return `${lines.join("\n")}\n`;
}
