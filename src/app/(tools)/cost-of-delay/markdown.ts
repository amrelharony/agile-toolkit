import { COST_OF_DELAY } from "@/lib/prioritization/methods";
import { formatNumber, toNumber } from "@/lib/prioritization/methods/fields";
import type { RankedRow } from "@/lib/prioritization/rank";
import { todayIso } from "@/lib/sprints/series";
import { codGroups, fixedDateStart, startText, waitingPerWeek } from "./lanes";
import { codVerdict } from "./verdict";

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

const money = (v: unknown) => {
  const n = toNumber(v);
  return n === undefined ? "—" : `$${formatNumber(n, 2)}`;
};
const weeks = (v: unknown) => {
  const n = toNumber(v);
  return n === undefined ? "—" : formatNumber(n, 2);
};

/**
 * The queue as Markdown, for a roadmap review: one table per lane in the
 * order work should start (expedite, fixed date by latest start, standard
 * and intangible by CD3), each initiative's cost per week, duration, CD3
 * and, for a fixed date, when it must start; rows from before CD3 last as
 * "Not scored" with their old total; then what waiting costs per week and
 * the verdict.
 */
export function toMarkdown(rows: readonly RankedRow[], now: Date = new Date()): string {
  const title = `# Cost of Delay — ${mdDate(now)}`;
  if (rows.length === 0) return `${title}\n\nNo initiatives yet.\n`;
  const today = todayIso(now);

  const lines = [
    title,
    "",
    "CD3 = cost of delay per week ÷ duration in weeks. Expedite first, then fixed dates by latest start, then standard and intangible work by CD3.",
    "",
  ];
  for (const g of codGroups(rows)) {
    if (g.rows.length === 0) continue;
    lines.push(
      `## ${g.label} (${g.rows.length})`,
      "",
      "| # | Initiative | $ per week | Weeks of work | CD3 | Note |",
      "|---:|---|---:|---:|---:|---|"
    );
    for (const r of g.rows) {
      const start = fixedDateStart(r, today);
      const legacy = toNumber(r.result.extra?.totalCost);
      const note = start
        ? startText(start, today)
        : r.result.score === null && legacy !== undefined
          ? `Old total $${formatNumber(legacy, 2)} (per week × weeks delayed)`
          : "";
      lines.push(
        `| ${r.rank ?? "—"} | ${cell(r.row.title)} | ${money(r.values.perWeekUsd)} | ${weeks(
          r.values.durationWeeks
        )} | ${r.result.score === null ? "Not scored" : COST_OF_DELAY.format(r.result.score)} | ${cell(note)} |`
      );
    }
    lines.push("");
  }
  const { perWeek, count } = waitingPerWeek(rows);
  if (count > 0) {
    lines.push(
      `Waiting costs $${formatNumber(perWeek, 2)} per week across ${count} scored ${
        count === 1 ? "initiative" : "initiatives"
      }.`,
      ""
    );
  }
  lines.push(`**${codVerdict(rows, today)}**`);
  return `${lines.join("\n")}\n`;
}
