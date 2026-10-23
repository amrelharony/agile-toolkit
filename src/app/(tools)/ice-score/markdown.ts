import type { PrioritizationItem } from "@/lib/stores/workspace-types";
import { rank } from "@/lib/analytics/scoring-rubric";
import { cell } from "@/lib/charts/chart-text";
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

/** The ICE list as a ranked Markdown table, for a growth review or a planning thread. */
export function toMarkdown(items: readonly PrioritizationItem[], now: Date = new Date()): string {
  const title = `# ICE Scores — ${mdDate(now)}`;
  if (items.length === 0) return `${title}\n\nNo ideas scored yet.\n`;

  const ranked = rank(
    items.map((x) => ({ id: x.id, title: x.title, fields: x.fields ?? {}, score: x.score ?? 0 }))
  );
  const lines = [
    title,
    "",
    "ICE = Impact × Confidence × Ease, each scored 1–10. Highest goes first.",
    "",
    "| # | Idea | Impact | Confidence | Ease | ICE |",
    "|---:|---|---:|---:|---:|---:|",
    ...ranked.map(
      (r) =>
        `| ${r.rank} | ${md(r.title)} | ${score(r.fields.impact)} | ${score(
          r.fields.confidence
        )} | ${score(r.fields.ease)} | ${cell(r.score)} |`
    ),
    "",
    `**${iceVerdict(items)}**`,
  ];
  return `${lines.join("\n")}\n`;
}
