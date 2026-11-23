/**
 * Flow Insights as Markdown, for a retro, a channel or the Product Owner:
 * the verdict, the mix per sprint or week, the mix against the target, the
 * repeat work and its trend, and team stability. Stability shows counts
 * only, never who joined or left. Pure.
 */

import { WORK_TYPE_LABEL } from "@/lib/flow/work-types";
import { FAILURE_WHY_LABEL, FLOW_TREND_MIN, type FlowInsights } from "@/lib/flow/distribution";

/** A table cell: one line, pipes escaped. */
function md(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

const pct = (n: number | null) => (n === null ? "—" : `${n}%`);

/** "23 Nov 2026" for a "YYYY-MM-DD", read as a local date. */
export function dateLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : day;
}

export function toMarkdown(x: FlowInsights, today: string): string {
  const unit = x.board === "sprint" ? "Sprint" : "Week";
  const lines = [`# Flow Insights — ${dateLabel(today)}`, "", `**${md(x.verdict)}**`];

  if (x.periods.length > 0) {
    lines.push(
      "",
      "## Work mix",
      "",
      `| ${unit} | Finished | Feature | Defect | Debt | Risk | Not sorted | Failure demand |`,
      "|---|---:|---:|---:|---:|---:|---:|---:|",
      ...x.periods.map(
        (p) =>
          `| ${md(p.label)} | ${p.finished} | ${p.counts.feature} | ${p.counts.defect} | ${p.counts.debt} | ${p.counts.risk} | ${p.unsorted} | ${pct(p.failurePct)} |`
      )
    );
  }

  lines.push("", "## Against the target", "");
  if (x.target) {
    lines.push(
      "| Type | Target | Delivered | Gap |",
      "|---|---:|---:|---:|",
      ...x.gaps.map(
        (g) =>
          `| ${WORK_TYPE_LABEL[g.type]} | ${g.target}% | ${pct(g.delivered)} | ${
            g.gap === null ? "—" : `${g.gap > 0 ? "+" : ""}${g.gap} points`
          } |`
      )
    );
  } else {
    lines.push("No target mix set yet.");
  }

  lines.push("", "## Failure demand", "");
  const finished = x.all.filter((p) => p.failurePct !== null).length;
  lines.push(
    x.trend
      ? x.trend.sentence
      : `A trend needs ${FLOW_TREND_MIN} ${unit.toLowerCase()}s with finished work; there are ${finished}.`
  );
  const latest = [...x.periods].reverse().find((p) => p.finished > 0);
  const repeat = latest ? latest.items.filter((it) => it.failure) : [];
  if (latest && repeat.length > 0) {
    lines.push(
      "",
      `Repeat work in ${md(latest.label)}:`,
      ...repeat.map(
        (it) =>
          `- ${md(it.title)} (${it.failureWhy ? FAILURE_WHY_LABEL[it.failureWhy] : "repeat work"})`
      )
    );
  }

  lines.push("", "## Team stability", "");
  const rows = x.stability.rows.slice(-Math.max(1, x.periods.length || 6));
  if (rows.length === 0) {
    lines.push("No finished sprints yet.");
  } else {
    lines.push(
      "| Sprint | People | Stayed | Joined | Left | Stability |",
      "|---|---:|---:|---:|---:|---:|",
      ...rows.map(
        (r) =>
          `| ${md(r.name)} | ${r.people} | ${r.stayed} | ${r.joined.length} | ${r.left.length} | ${pct(r.pct)} |`
      )
    );
  }

  const notes: string[] = [];
  if (x.totals.guessed > 0) {
    notes.push(
      `${x.totals.guessed} of the ${x.totals.finished} finished items are sorted by a guess from their title, tags or the tool they came from.`
    );
  }
  if (x.totals.unsorted > 0) notes.push(`${x.totals.unsorted} aren't sorted yet.`);
  if (rows.length > 0) {
    notes.push(
      rows.some((r) => r.rough)
        ? "Stability is rough where a sprint has no capacity plan of its own: it comes from who owned its stories."
        : "Stability comes from each sprint's own capacity plan."
    );
  }
  if (notes.length) lines.push("", "## Data notes", "", ...notes.map((n) => `- ${n}`));
  return `${lines.join("\n")}\n`;
}
