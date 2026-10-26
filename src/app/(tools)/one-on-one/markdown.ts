import { NO_VALUE } from "@/lib/charts/chart-text";
import {
  STATUS_LABELS,
  cadenceVerdict,
  targetText,
  type AgendaItem,
  type Meeting,
  type ReportCadence,
} from "./model";

const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " ").trim();
/** A table cell: one line, with pipes escaped so they don't split the cell. */
const cell = (v: string | number) => oneLine(String(v)).replace(/\|/g, "\\|");

function item(a: AgendaItem): string {
  const parts = [`- **${STATUS_LABELS[a.status]}** ${oneLine(a.text)}`];
  const follow = [
    a.action ? oneLine(a.action) : null,
    a.owner ? `owner ${oneLine(a.owner)}` : null,
    a.dueDate ? `due ${a.dueDate}` : null,
    a.status === "done" && a.doneAt ? `done ${a.doneAt}` : null,
  ].filter(Boolean);
  if (follow.length > 0) parts.push(`→ ${follow.join(" · ")}`);
  if (a.carriedFrom) parts.push("(carried over)");
  return parts.join(" ");
}

/**
 * The 1:1s as Markdown: the cadence per report, then every 1:1 newest first
 * with its agenda, actions and notes. It leaves the page only when someone
 * presses Export: the notes are the manager's.
 */
export function oneOnOnesToMarkdown(
  meetings: readonly Meeting[],
  cadence: readonly ReportCadence[]
): string {
  const lines = ["# 1:1s", "", `> ${oneLine(cadenceVerdict(cadence))}`, ""];
  if (cadence.length > 0) {
    lines.push(
      "## Cadence",
      "",
      "| Report | 1:1s | Last 1:1 | Cadence | Past it by | Open actions |",
      "| --- | --- | --- | --- | --- | --- |",
      ...cadence.map(
        (r) =>
          `| ${[
            r.name,
            r.meetings,
            r.lastDate ?? NO_VALUE,
            targetText(r) || NO_VALUE,
            r.overdueBy !== null ? `${r.overdueBy} d` : NO_VALUE,
            r.openActions,
          ]
            .map(cell)
            .join(" | ")} |`
      ),
      ""
    );
  }
  lines.push("## Meetings", "");
  if (meetings.length === 0) {
    lines.push("No 1:1s yet.");
    return `${lines.join("\n")}\n`;
  }
  const newest = [...meetings].sort((a, b) => b.date.localeCompare(a.date));
  for (const m of newest) {
    lines.push(`### ${m.date || "No date"} · ${oneLine(m.manager)} ↔ ${oneLine(m.report)}`, "");
    if (m.description?.trim()) lines.push(oneLine(m.description), "");
    if (m.agenda.length === 0) lines.push("No agenda items.");
    else lines.push(...m.agenda.map(item));
    if (m.notes?.trim()) {
      lines.push(
        "",
        "Notes:",
        "",
        ...m.notes
          .trim()
          .split(/\r?\n/)
          .map((l) => `> ${l}`)
      );
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
