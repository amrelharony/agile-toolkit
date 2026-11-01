import { WSJF } from "@/lib/prioritization/methods";
import type { RankedRow } from "@/lib/prioritization/rank";
import { wsjfVerdict } from "./verdict";

/** "18 Oct 2026" */
function mdDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** A table cell: one line, pipes escaped. */
function cell(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

const field = (v: number | string | undefined) => (v === undefined || v === "" ? "—" : cell(v));

/**
 * The WSJF backlog as a ranked Markdown table, for a wiki page or a PI
 * planning thread: each feature's parts as the page shows them (a linked
 * row's from its backlog item), the registry's score and rank, unscored
 * features last as "Not scored", then the verdict (with the relative
 * hint when a column has no 1).
 */
export function toMarkdown(rows: readonly RankedRow[], now: Date = new Date()): string {
  const title = `# WSJF — ${mdDate(now)}`;
  if (rows.length === 0) return `${title}\n\nNo features scored yet.\n`;

  const lines = [
    title,
    "",
    "WSJF = (Business Value + Time Criticality + RR/OE) ÷ Job Size, each part on 1, 2, 3, 5, 8, 13, 20 relative to the others. Highest goes first.",
    "",
    "## Ranked features",
    "",
    "| # | Feature | BV | TC | RR/OE | Size | WSJF |",
    "|---:|---|---:|---:|---:|---:|---:|",
    ...rows.map(
      (r) =>
        `| ${r.rank ?? "—"} | ${cell(r.row.title)} | ${field(r.values.businessValue)} | ${field(
          r.values.timeCriticality
        )} | ${field(r.values.rrOe)} | ${field(r.values.jobSize)} | ${
          r.result.score === null ? "Not scored" : WSJF.format(r.result.score)
        } |`
    ),
    "",
    `**${wsjfVerdict(rows)}**`,
  ];
  return `${lines.join("\n")}\n`;
}
