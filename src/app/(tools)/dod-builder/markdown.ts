import type { DefinitionOfDone } from "@/lib/stores/workspace-types";
import {
  DOD_CATEGORIES,
  DOD_CATEGORY_LABEL,
  type DodAdherence,
  type SprintAdherenceRow,
} from "@/lib/dod/model";
import { pctCell } from "./adherence";

const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " ").trim();
/** A table cell: one line, with pipes escaped so they don't split the cell. */
const cell = (v: string | number) => oneLine(String(v)).replace(/\|/g, "\\|");

export interface DodMarkdownOptions {
  verdict?: string;
  /** The sprint the adherence is for, and its numbers. */
  sprint?: { name: string; adherence: DodAdherence };
  bySprint?: readonly SprintAdherenceRow[];
}

/**
 * The Definition of Done as Markdown: the criteria by category (Required
 * or optional), the sprint's adherence with the stories that miss it, and
 * adherence per sprint as a table.
 */
export function dodMarkdown(
  doc: Pick<DefinitionOfDone, "items">,
  { verdict, sprint, bySprint = [] }: DodMarkdownOptions = {}
): string {
  const lines = ["# Definition of Done", ""];
  if (verdict) lines.push(`> ${oneLine(verdict)}`, "");
  if (doc.items.length === 0) {
    lines.push("Not written yet.");
    return `${lines.join("\n")}\n`;
  }
  for (const cat of DOD_CATEGORIES) {
    const items = doc.items.filter((i) => i.category === cat);
    if (items.length === 0) continue;
    lines.push(`## ${DOD_CATEGORY_LABEL[cat]}`, "");
    for (const i of items) {
      lines.push(`- ${oneLine(i.label)}${i.required ? "" : " (optional)"}`);
      if (i.description) lines.push(`  ${oneLine(i.description)}`);
    }
    lines.push("");
  }
  if (sprint) {
    const a = sprint.adherence;
    lines.push(`## ${oneLine(sprint.name)}`, "");
    lines.push(
      a.done === 0
        ? "No story is done yet."
        : `${a.meeting} of ${a.done} done ${a.done === 1 ? "story meets" : "stories meet"} the DoD (${pctCell(a.pct)}).`,
      ""
    );
    if (a.missing.length > 0) {
      for (const m of a.missing) {
        lines.push(`- ${oneLine(m.title)}: needs ${m.open.map(oneLine).join(", ")}`);
      }
      lines.push("");
    }
  }
  if (bySprint.length > 0) {
    lines.push(
      "## Adherence by sprint",
      "",
      "| Sprint | Done stories | Meeting the DoD | Adherence |",
      "| --- | --- | --- | --- |",
      ...bySprint.map((r) => `| ${cell(r.name)} | ${r.done} | ${r.meeting} | ${pctCell(r.pct)} |`),
      ""
    );
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
