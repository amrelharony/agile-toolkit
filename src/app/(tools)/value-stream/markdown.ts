import type { ValueStreamStage } from "@/lib/stores/workspace-types";
import { NO_VALUE, fmt } from "@/lib/charts/chart-text";
import {
  STATE_LABEL,
  accuracyOf,
  bottleneck,
  compareStates,
  comparisonVerdict,
  leadOf,
  orderedStages,
  processOf,
  vsmSummary,
  vsmVerdict,
  waitOf,
  type ValueStreamState,
} from "@/lib/value-stream/summary";
import { comparisonRows } from "./chart-text";

/** A table cell: one line, pipes escaped. */
function md(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

const pct = (n: number | null) => (n === null ? NO_VALUE : `${fmt(n, 0)}%`);

function mapSection(stages: readonly ValueStreamStage[], state: ValueStreamState): string[] {
  const s = vsmSummary(stages);
  const b = bottleneck(stages);
  return [
    `## ${STATE_LABEL[state]}`,
    "",
    "| # | Stage | Process (d) | Wait (d) | Lead (d) | %C/A |",
    "|---:|---|---:|---:|---:|---:|",
    ...stages.map(
      (st, i) =>
        `| ${i + 1} | ${md(st.name) || "Unnamed stage"}${b?.stage.id === st.id ? " (bottleneck)" : ""} | ${fmt(
          processOf(st)
        )} | ${fmt(waitOf(st))} | ${fmt(leadOf(st))} | ${fmt(accuracyOf(st), 0)}% |`
    ),
    "",
    `Lead time ${fmt(s.totalLead)} d, process time ${fmt(s.totalProcess)} d, wait ${fmt(
      s.totalWait
    )} d. Flow efficiency ${pct(s.flowEfficiency)}, rolled %C/A ${pct(s.rolledCA)}.`,
    ...(b
      ? [
          "",
          `Bottleneck: ${md(b.stage.name) || "an unnamed stage"}, waiting ${fmt(b.waitDays)} d (${fmt(
            b.sharePct,
            0
          )}% of the lead time).`,
        ]
      : []),
  ];
}

/**
 * The map for a retro or an improvement plan: the verdict, each map's
 * stages in order with the bottleneck marked, its totals, and the
 * current-versus-future comparison when there is a future state.
 */
export function valueStreamToMarkdown(stages: readonly ValueStreamStage[], today: string): string {
  const current = orderedStages(stages, "current");
  const future = orderedStages(stages, "future");
  const title = `# Value stream map — ${today}`;
  if (current.length === 0 && future.length === 0) return `${title}\n\nNo stages mapped yet.\n`;
  const comparison = compareStates(current, future);
  const lines = [title, "", `**${vsmVerdict(current)}**`];
  const compared = comparisonVerdict(comparison);
  if (compared) lines.push("", compared);
  if (current.length > 0) lines.push("", ...mapSection(current, "current"));
  if (future.length > 0) lines.push("", ...mapSection(future, "future"));
  if (comparison && current.length > 0) {
    lines.push(
      "",
      "## Current vs future",
      "",
      "| Measure | Current | Future | Change |",
      "|---|---:|---:|---:|",
      ...comparisonRows(comparison).map(
        (r) => `| ${r.measure} | ${r.current} | ${r.future} | ${r.change} |`
      )
    );
  }
  return `${lines.join("\n")}\n`;
}
