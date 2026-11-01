import { FIBONACCI_VALUES } from "@/lib/prioritization/methods/fibonacci";
import { VE_HIGH_EFFORT_FROM, VE_HIGH_VALUE_FROM } from "@/lib/prioritization/methods/value-effort";
import type { RankedRow } from "@/lib/prioritization/rank";
import { UNPLACED, placeOf, ratioText, veGroups } from "./model";
import { veVerdict } from "./verdict";

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
 * The matrix as Markdown, for a planning thread: the rule, one table per
 * quadrant in do-first order (best value ÷ effort first), the items still
 * to place, and the verdict.
 */
export function toMarkdown(rows: readonly RankedRow[], now: Date = new Date()): string {
  const title = `# Value vs Effort — ${mdDate(now)}`;
  if (rows.length === 0) return `${title}\n\nNo items yet.\n`;
  const lines = [
    title,
    "",
    `Value is on the scale ${FIBONACCI_VALUES.join(", ")} (${VE_HIGH_VALUE_FROM} or more is high); effort runs 1–10 (${VE_HIGH_EFFORT_FROM} or more is high).`,
  ];
  for (const g of veGroups(rows)) {
    if (g.id === UNPLACED) {
      if (g.rows.length === 0) continue;
      lines.push("", `## ${g.label} (${g.rows.length})`, "");
      for (const r of g.rows) lines.push(`- ${md(r.row.title)}`);
      continue;
    }
    lines.push("", `## ${g.label} (${g.rows.length})`, "", g.meaning, "");
    if (g.rows.length === 0) {
      lines.push("None.");
      continue;
    }
    lines.push("| Item | Value | Effort | Value ÷ effort |", "|---|---:|---:|---:|");
    for (const r of g.rows) {
      const at = placeOf(r);
      lines.push(
        `| ${md(r.row.title)} | ${at.value ?? "—"} | ${at.effort ?? "—"} | ${ratioText(r) ?? "—"} |`
      );
    }
  }
  lines.push("", `**${veVerdict(rows)}**`);
  return `${lines.join("\n")}\n`;
}
