/**
 * One weighted matrix as Markdown: the question, the criteria with their
 * weights, shares and what a 1 and a 10 mean, the score matrix ("—" for a
 * cell not scored), each option's total or partial total, the leader, the
 * tie and sensitivity notes, and where the result was sent.
 */

import type { WeightedMatrix, WeightedOption } from "@/lib/stores/workspace-types";
import {
  cellOf,
  formatTotal,
  matrixTitle,
  sensitivityText,
  type MatrixResult,
} from "@/lib/weighted/model";
import type { ChartTable } from "@/lib/charts/chart-text";

/** A table cell's text, with pipes escaped and on one line. */
const cellText = (s: string) =>
  s
    .replace(/\|/g, "\\|")
    .replace(/\s*\n+\s*/g, " ")
    .trim();

export function matrixToMarkdown(
  matrix: WeightedMatrix,
  r: MatrixResult,
  options: readonly WeightedOption[],
  { sentLabel }: { sentLabel?: string } = {}
): string {
  const out: string[] = [`# ${cellText(matrixTitle(matrix))}`, ""];
  if (matrix.question?.trim() && matrix.name.trim()) out.push(`Matrix: ${matrix.name.trim()}`, "");
  out.push(r.verdict, "");

  if (r.criteria.length > 0) {
    out.push(
      "## Criteria",
      "",
      "| Criterion | Weight | Share | 1 means | 10 means |",
      "|---|---|---|---|---|"
    );
    for (const c of r.criteria) {
      out.push(
        `| ${cellText(c.name)} | ${c.weight} | ${c.active ? `${Math.round(c.share * 100)}%` : "not counted"} | ${cellText(c.low ?? "")} | ${cellText(c.high ?? "")} |`
      );
    }
    out.push("");
  }

  if (r.options.length > 0 && r.criteria.length > 0) {
    const byId = new Map(options.map((o) => [o.id, o]));
    out.push(
      "## Scores",
      "",
      `| Option | ${r.criteria.map((c) => cellText(c.name)).join(" | ")} | Total |`,
      `|---|${r.criteria.map(() => "---").join("|")}|---|`
    );
    for (const o of r.options) {
      const row = byId.get(o.id);
      const cells = r.criteria.map((c) => {
        const cell = row ? cellOf(row, c.id) : { kind: "empty" as const };
        return cell.kind === "scored"
          ? String(cell.value)
          : cell.kind === "off"
            ? `${cell.value} (off scale)`
            : "—";
      });
      const star = o.id === r.leaderId ? " ★" : "";
      const total =
        o.total !== null
          ? `${formatTotal(o.total)}${star}`
          : `partial ${formatTotal(o.partialTotal)} (${o.unscored.length} not scored)`;
      out.push(`| ${cellText(o.name)} | ${cells.join(" | ")} | ${total} |`);
    }
    out.push("");
  }

  const notes: string[] = [];
  if (r.tie) notes.push("- Too close to call: the top totals are within 5% of each other.");
  for (const f of r.sensitivity) notes.push(`- ${sensitivityText(f)}`);
  if (notes.length > 0) out.push("## Sensitivity", "", ...notes, "");
  if (sentLabel) out.push(sentLabel, "");
  return out.join("\n").trimEnd();
}

/** The chart's text: the complete options' totals, in rank order. */
export function totalsChartText(r: MatrixResult): { summary: string; table: ChartTable } {
  const complete = r.options.filter((o) => o.total !== null);
  const left = r.options.length - complete.length;
  const summary =
    complete.length === 0
      ? "No option is fully scored yet, so nothing is charted."
      : `${complete.length === 1 ? "1 option" : `${complete.length} options`} fully scored; ${complete[0].name} has the highest total, ${formatTotal(complete[0].total ?? 0)}.${left > 0 ? ` ${left === 1 ? "1 option isn't" : `${left} options aren't`} charted until every cell is scored.` : ""}`;
  return {
    summary,
    table: {
      columns: ["Option", "Total", "Rank"],
      rows: complete.map((o) => [o.name, formatTotal(o.total ?? 0), o.rank ?? "—"]),
      caption: "Weighted totals",
    },
  };
}
