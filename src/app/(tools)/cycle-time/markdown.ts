import { NO_VALUE, fmt } from "@/lib/charts/chart-text";
import type { AgeingItem, StageBreakdown } from "@/lib/flow";
import type { CycleRow, CycleSource } from "./types";
import { PERCENTILE_KEYS, SOURCE_LABEL, type CycleStats } from "./helpers";
import { cycleTimeVerdict } from "./verdict";
import { stageMarkdown } from "./stage-text";

/** A table cell: one line, pipes escaped. */
function md(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

const STAGE_LABEL: Record<string, string> = { in_progress: "In progress", review: "Review" };

/**
 * Cycle time for a retro or a status report: the verdict, the summary
 * (each figure only once there are enough items, as on the page), the SLE
 * and percentile table, the ageing work in progress, the time in each
 * status (when given), and the finished items by source.
 */
export function cycleTimeToMarkdown(input: {
  today: string;
  rows: readonly CycleRow[];
  sources: ReadonlySet<CycleSource>;
  stats: CycleStats;
  ageing: readonly AgeingItem[];
  sle: { pct: number; days: number | null };
  /** Time in each status for the stories and cards shown (lib/flow stageBreakdown). */
  stages?: StageBreakdown;
}): string {
  const { today, rows, sources, stats, ageing, sle, stages } = input;
  const s = stats.summary;
  const lines = [
    `# Cycle time — ${today}`,
    "",
    `From: ${
      (["story", "card", "typed"] as const)
        .filter((src) => sources.has(src))
        .map((src) => SOURCE_LABEL[src])
        .join(", ") || NO_VALUE
    }. Days count the start and the finish, so a same-day item is 1 day.`,
    "",
    `**${cycleTimeVerdict(stats, ageing, sle)}**`,
    "",
    `- Finished items: ${s.count}`,
    `- Average: ${stats.averageQuoted && s.average !== null ? `${fmt(s.average)} days` : NO_VALUE}`,
    `- Median: ${stats.distributionQuoted && s.median !== null ? `${fmt(s.median)} days` : NO_VALUE}`,
    `- 85th percentile: ${stats.distributionQuoted && s.p85 !== null ? `${fmt(s.p85)} days` : NO_VALUE}`,
    `- Spread (standard deviation): ${stats.distributionQuoted && s.spread !== null ? `${fmt(s.spread)} days` : NO_VALUE}`,
  ];
  if (stats.distributionQuoted) {
    lines.push(
      "",
      "## Service level expectation",
      "",
      sle.days !== null ? `${sle.pct}% of items finish within ${sle.days} days.` : NO_VALUE,
      "",
      "| Percentile | Cycle time |",
      "|---|---:|",
      ...PERCENTILE_KEYS.map((p) => `| ${p}th | ${stats.percentiles[p] ?? NO_VALUE} days |`)
    );
  }
  if (ageing.length > 0) {
    lines.push(
      "",
      `## Work in progress (${ageing.length})`,
      "",
      "| Item | Stage | Owner | Age | Over the P85 |",
      "|---|---|---|---:|---|",
      ...ageing.map(
        (a) =>
          `| ${md(a.title)}${a.blocked ? " (blocked)" : ""} | ${STAGE_LABEL[a.stage] ?? a.stage} | ${
            md(a.owner) || NO_VALUE
          } | ${a.ageDays} days | ${a.overP85 === null ? NO_VALUE : a.overP85 ? "Yes" : "No"} |`
      )
    );
  }
  if (stages) lines.push(...stageMarkdown(stages));
  if (rows.length > 0) {
    lines.push(
      "",
      "## Finished items",
      "",
      "| Item | Source | Started | Finished | Days |",
      "|---|---|---|---|---:|",
      ...rows.map(
        (r) =>
          `| ${md(r.title)} | ${SOURCE_LABEL[r.source]} | ${r.startedOn} | ${r.doneOn} | ${r.days} |`
      )
    );
  }
  return `${lines.join("\n")}\n`;
}
