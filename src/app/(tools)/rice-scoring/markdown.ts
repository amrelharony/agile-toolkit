import { RICE } from "@/lib/prioritization/methods";
import { toChoice } from "@/lib/prioritization/methods/fields";
import { REACH_PERIODS, REACH_PERIOD_LABEL } from "@/lib/prioritization/methods/rice";
import type { RankedRow } from "@/lib/prioritization/rank";
import { outliersOf } from "./analysis";
import { riceVerdict } from "./verdict";

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

const field = (v: number | string | undefined, suffix = "") =>
  v === undefined || v === "" ? "—" : `${cell(v)}${suffix}`;

/**
 * The RICE backlog as a ranked Markdown table, for a roadmap page or a
 * planning thread: each row's inputs as the page shows them (a linked
 * row's from its backlog item), the reach period, the registry's score
 * and rank, unscored rows last. Outliers are named once there are enough
 * scores for a spread.
 */
export function toMarkdown(rows: readonly RankedRow[], now: Date = new Date()): string {
  const title = `# RICE Scoring — ${mdDate(now)}`;
  if (rows.length === 0) return `${title}\n\nNo initiatives scored yet.\n`;

  const outliers = outliersOf(rows) ?? new Set<string>();
  const lines = [
    title,
    "",
    "RICE = Reach per quarter × Impact × Confidence ÷ Effort (person-months). Highest goes first.",
    "",
    "## Ranked initiatives",
    "",
    "| # | Initiative | Reach | Period | Impact | Confidence | Effort | RICE |",
    "|---:|---|---:|---|---:|---:|---:|---:|",
    ...rows.map((r) => {
      const period = toChoice(REACH_PERIODS, r.values.reachPeriod) ?? "quarter";
      return `| ${r.rank ?? "—"} | ${cell(r.row.title)}${outliers.has(r.row.id) ? " (outlier)" : ""} | ${field(
        r.values.reach
      )} | ${REACH_PERIOD_LABEL[period]} | ${field(r.values.impact)} | ${field(
        r.values.confidence,
        "%"
      )} | ${field(r.values.effort)} | ${
        r.result.score === null ? "Not scored" : RICE.format(r.result.score)
      } |`;
    }),
    "",
    `**${riceVerdict(rows)}**`,
  ];
  if (outliers.size > 0) {
    lines.push(
      "",
      "An outlier score sits far from the rest: re-check its inputs before acting on it."
    );
  }
  return `${lines.join("\n")}\n`;
}
