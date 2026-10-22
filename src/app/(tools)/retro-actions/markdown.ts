import type { RetroAction, RetroActionSummary } from "@/lib/retro/actions";

const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " ").trim();

/** The action list as a Markdown checklist, grouped by retro. */
export function actionsToMarkdown(
  actions: readonly RetroAction[],
  summary: RetroActionSummary
): string {
  const lines = ["# Retro actions", ""];
  lines.push(
    `${summary.open} open${summary.overdue > 0 ? ` (${summary.overdue} overdue)` : ""} · ${summary.done} done`,
    ""
  );
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
    ].filter(Boolean);
    lines.push(`- [${a.done ? "x" : " "}] ${oneLine(a.text)} — ${meta.join(" · ")}`);
  }
  return `${lines.join("\n")}\n`;
}
