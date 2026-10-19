import type { PrioritizationItem } from "@/lib/stores/workspace-types";
import { rank } from "@/lib/analytics/scoring-rubric";

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

/** The WSJF backlog as a ranked Markdown table, for a wiki page or a PI planning thread. */
export function toMarkdown(items: readonly PrioritizationItem[], now: Date = new Date()): string {
  const title = `# WSJF — ${mdDate(now)}`;
  if (items.length === 0) return `${title}\n\nNo features scored yet.\n`;

  const ranked = rank(
    items.map((x) => ({ id: x.id, title: x.title, fields: x.fields ?? {}, score: x.score ?? 0 }))
  );
  const top = ranked.filter((r) => r.rank === 1);

  const lines = [
    title,
    "",
    "WSJF = (Business Value + Time Criticality + RR/OE) ÷ Job Size. Highest goes first.",
    "",
    "## Ranked features",
    "",
    "| # | Feature | BV | TC | RR/OE | Size | WSJF |",
    "|---:|---|---:|---:|---:|---:|---:|",
    ...ranked.map(
      (r) =>
        `| ${r.rank} | ${cell(r.title)} | ${field(r.fields.businessValue)} | ${field(
          r.fields.timeCriticality
        )} | ${field(r.fields.rrOe)} | ${field(r.fields.jobSize)} | ${r.score.toFixed(2)} |`
    ),
    "",
    `**Do first:** ${top.map((r) => cell(r.title)).join(", ")} (WSJF ${top[0].score.toFixed(2)})`,
  ];
  return `${lines.join("\n")}\n`;
}
