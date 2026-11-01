import { ICE } from "@/lib/prioritization/methods";
import type { RankedRow } from "@/lib/prioritization/rank";
import { iceVerdict } from "./verdict";

/** "18 Oct 2026" */
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

const score = (v: unknown) => (v === undefined || v === null || v === "" ? "—" : md(v));

/**
 * The ICE list as a ranked Markdown table, for a growth review or a
 * planning thread: the ranks and scores as the page shows them (the
 * registry's), unscored ideas last as "Not scored".
 */
export function toMarkdown(rows: readonly RankedRow[], now: Date = new Date()): string {
  const title = `# ICE Scores — ${mdDate(now)}`;
  if (rows.length === 0) return `${title}\n\nNo ideas scored yet.\n`;

  const lines = [
    title,
    "",
    "ICE = Impact × Confidence × Ease, each scored 1–10. Highest goes first.",
    "",
    "| # | Idea | Impact | Confidence | Ease | ICE |",
    "|---:|---|---:|---:|---:|---:|",
    ...rows.map(
      (r) =>
        `| ${r.rank ?? "—"} | ${md(r.row.title)} | ${score(r.values.impact)} | ${score(
          r.values.confidence
        )} | ${score(r.values.ease)} | ${
          r.result.score === null ? "Not scored" : ICE.format(r.result.score)
        } |`
    ),
    "",
    `**${iceVerdict(rows)}**`,
  ];
  return `${lines.join("\n")}\n`;
}
