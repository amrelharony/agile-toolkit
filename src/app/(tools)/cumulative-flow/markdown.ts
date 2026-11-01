import { NO_VALUE, fmt } from "@/lib/charts/chart-text";
import { enoughData } from "@/lib/analytics/min-sample";
import type { CfdMetrics, CfdView } from "./view";
import { cfdVerdict } from "./verdict";

/** A table cell: one line, pipes escaped. */
function md(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

const SOURCE_LABEL = {
  sprint: "the Sprint board's stories",
  flow: "the Flow board's cards",
  typed: "typed snapshots",
} as const;

/**
 * The flow for a retro or a status report: where the counts come from and
 * over which days, the verdict, today's WIP, throughput and Little's Law
 * lead time (each only once there are enough days, as on the page), and
 * the counts per stage per day.
 */
export function cfdToMarkdown(
  view: CfdView,
  metrics: CfdMetrics,
  opts: { today: string; sprintName?: string; wipLimit: number | null }
): string {
  const title = `# Cumulative flow — ${opts.today}`;
  const from = `From ${SOURCE_LABEL[view.source]}${
    view.source === "sprint" && opts.sprintName ? ` (${md(opts.sprintName)})` : ""
  }`;
  const { days, workflow } = view;
  if (days.length === 0) return `${title}\n\n${from}.\n\n${cfdVerdict(view, metrics)}\n`;
  const range = `${days[0].date} to ${days[days.length - 1].date}`;
  const lines = [title, "", `${from}, ${range}.`, "", `**${cfdVerdict(view, metrics)}**`, ""];
  const latest = metrics.latest;
  const law = metrics.littles;
  lines.push(
    `- Stages: ${workflow.stages.map((s) => md(s.label)).join(" → ")}`,
    `- Items on the board: ${latest ? latest.total : NO_VALUE}`,
    `- Work in progress: ${latest?.wip ?? NO_VALUE}${
      opts.wipLimit !== null ? ` (limit ${opts.wipLimit})` : ""
    }`,
    `- Throughput: ${
      metrics.throughputPerDay === null ? NO_VALUE : `${fmt(metrics.throughputPerDay, 2)} a day`
    }`,
    `- Lead time (Little's Law, average WIP ÷ throughput): ${
      law ? `≈ ${fmt(law.leadTimeDays)} days` : NO_VALUE
    }`
  );
  if (metrics.measured && view.source !== "typed") {
    const m = metrics.measured;
    lines.push(
      `- Measured cycle time of the ${m.count} finished: ${
        m.average !== null && enoughData(m.count, "average")
          ? `${fmt(m.average)} days on average`
          : NO_VALUE
      }`
    );
  }
  if (view.approximate > 0) {
    lines.push(
      `- ${view.approximate} ${view.approximate === 1 ? "item is" : "items are"} placed from start and done times; their move history wasn't kept.`
    );
  }
  for (const drop of metrics.doneDrops) {
    lines.push(
      `- Done fell from ${drop.from} to ${drop.to} on ${drop.date}: Done is a running total.`
    );
  }
  lines.push(
    "",
    "## Items per stage by day",
    "",
    `| Date | ${workflow.stages.map((s) => md(s.label)).join(" | ")} |`,
    `|---|${workflow.stages.map(() => "---:").join("|")}|`,
    ...days.map(
      (d) => `| ${d.date} | ${workflow.stages.map((s) => d.counts[s.id] ?? 0).join(" | ")} |`
    )
  );
  return `${lines.join("\n")}\n`;
}
