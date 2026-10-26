import { KANO_CLASSES, KANO_MIN_RESPONSES } from "@/lib/prioritization/methods/kano";
import type { RankedRow } from "@/lib/prioritization/rank";
import { GROUP_LABEL, answersText, coefText, kanoGroups } from "./model";
import { kanoVerdict } from "./verdict";

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
 * The features as Markdown, for a product review: the rule, one table in
 * list order (what customers expect first) with each feature's counts,
 * Better and Worse ("—" under 3 answers), and the verdict.
 */
export function toMarkdown(rows: readonly RankedRow[], now: Date = new Date()): string {
  const title = `# Kano Model — ${mdDate(now)}`;
  if (rows.length === 0) return `${title}\n\nNo features yet.\n`;
  const lines = [
    title,
    "",
    `Category = the most common answer class (from ${KANO_MIN_RESPONSES} answers; a tie goes M, O, A, I, R, Q). Better = (A+O)/(A+O+M+I), Worse = −(O+M)/(A+O+M+I).`,
    "",
    `| Feature | Category | Answers | ${KANO_CLASSES.join(" | ")} | Better | Worse |`,
    `|---|---|---|${KANO_CLASSES.map(() => "---:").join("|")}|---:|---:|`,
  ];
  for (const g of kanoGroups(rows)) {
    for (const f of g.features) {
      const c = f.reading.counts;
      const category = f.picked ? `${GROUP_LABEL[g.id]} (picked by hand)` : GROUP_LABEL[g.id];
      lines.push(
        `| ${md(f.ranked.row.title)} | ${category} | ${md(answersText(f))} | ${KANO_CLASSES.map((k) => (c ? c[k] : "—")).join(" | ")} | ${coefText(f.coefficients?.better)} | ${coefText(f.coefficients?.worse)} |`
      );
    }
  }
  lines.push("", `**${kanoVerdict(rows)}**`);
  return `${lines.join("\n")}\n`;
}
