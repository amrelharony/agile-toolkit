import type { RetroAction, RetroActionSummary, RetroFollowThrough } from "@/lib/retro/actions";
import { followThroughText, ratedRetros, type SprintNameOf } from "./follow-through";

const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " ").trim();
/** A table cell: one line, with pipes escaped so they don't split the cell. */
const cell = (v: string | number) => oneLine(String(v)).replace(/\|/g, "\\|");

const noSprint: SprintNameOf = () => undefined;

export interface ActionsMarkdownOptions {
  /** Past retros' follow-through, oldest first (followThroughByRetro). */
  followThrough?: readonly RetroFollowThrough[];
  sprintName?: SprintNameOf;
  /** The page's one-sentence verdict, quoted under the counts. */
  verdict?: string;
}

/**
 * The action list as a Markdown checklist, grouped by retro, after the
 * counts and a "Follow-through by retro" table (past retros that agreed
 * actions, oldest first) when there is one.
 */
export function actionsToMarkdown(
  actions: readonly RetroAction[],
  summary: RetroActionSummary,
  { followThrough = [], sprintName = noSprint, verdict }: ActionsMarkdownOptions = {}
): string {
  const lines = ["# Retro actions", ""];
  lines.push(
    `${summary.open} open${summary.overdue > 0 ? ` (${summary.overdue} overdue)` : ""} · ${summary.done} done`,
    ""
  );
  if (verdict) lines.push(`> ${oneLine(verdict)}`, "");
  if (ratedRetros(followThrough).length > 0) {
    const { table } = followThroughText(followThrough, sprintName);
    lines.push(
      "## Follow-through by retro",
      "",
      `| ${table.columns.join(" | ")} |`,
      `| ${table.columns.map(() => "---").join(" | ")} |`,
      ...table.rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
      ""
    );
  }
  if (actions.length === 0) {
    lines.push("No action items yet.");
    return `${lines.join("\n")}\n`;
  }
  let lastBoard: string | null = null;
  for (const a of actions) {
    if (a.boardId !== lastBoard) {
      if (lastBoard !== null) lines.push("");
      lines.push(`## ${a.retroLabel}`, "");
      lastBoard = a.boardId;
    }
    const meta = [
      a.assignee.trim() ? `Owner: ${oneLine(a.assignee)}` : "No owner yet",
      a.dueDate ? `due ${a.dueDate}` : null,
      a.overdue ? "overdue" : null,
      a.closedByTarget ? "done in the linked tool" : null,
      a.carriedFrom ? "carried over" : null,
    ].filter(Boolean);
    lines.push(`- [${a.done ? "x" : " "}] ${oneLine(a.text)} — ${meta.join(" · ")}`);
  }
  return `${lines.join("\n")}\n`;
}
