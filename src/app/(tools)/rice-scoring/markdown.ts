import type { PrioritizationItem } from "@/lib/stores/workspace-types";
import { detectOutliers, rank } from "@/lib/analytics/scoring-rubric";

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

/** The RICE backlog as a ranked Markdown table, for a roadmap page or a planning thread. */
export function toMarkdown(items: readonly PrioritizationItem[], now: Date = new Date()): string {
  const title = `# RICE Scoring — ${mdDate(now)}`;
  if (items.length === 0) return `${title}\n\nNo initiatives scored yet.\n`;

  const scored = items.map((x) => ({
    id: x.id,
    title: x.title,
    fields: x.fields ?? {},
    score: x.score ?? 0,
  }));
  const ranked = rank(scored);
  const outliers = detectOutliers(scored);
  const top = ranked.filter((r) => r.rank === 1);

  const lines = [
    title,
    "",
    "RICE = Reach × Impact × Confidence ÷ Effort. Highest goes first.",
    "",
    "## Ranked initiatives",
    "",
    "| # | Initiative | Reach | Impact | Confidence | Effort | RICE |",
    "|---:|---|---:|---:|---:|---:|---:|",
    ...ranked.map((r) => {
      // Rows saved through the MCP actions keep confidence as `confidencePct`.
      const confidence = r.fields.confidence ?? r.fields.confidencePct;
      return `| ${r.rank} | ${cell(r.title)}${outliers.has(r.id) ? " (outlier)" : ""} | ${field(
        r.fields.reach
      )} | ${field(r.fields.impact)} | ${field(confidence, "%")} | ${field(
        r.fields.effort
      )} | ${r.score.toFixed(2)} |`;
    }),
    "",
    `**Do first:** ${top.map((r) => cell(r.title)).join(", ")} (RICE ${top[0].score.toFixed(2)})`,
  ];
  if (outliers.size > 0) {
    lines.push(
      "",
      "An outlier score sits far from the rest: re-check its inputs before acting on it."
    );
  }
  return `${lines.join("\n")}\n`;
}
