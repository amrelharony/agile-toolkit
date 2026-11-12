/**
 * Cycle Time Analyzer — the words for Time in each status: the flow
 * efficiency sentence, each item's bar as text, and the export's section.
 * Pure (lib/flow stageBreakdown in, strings out), so the page, its export
 * and the tests read the same sentences.
 */

import { NO_VALUE } from "@/lib/charts/chart-text";
import {
  STAGE_LABEL,
  itemEfficiency,
  stageDuration,
  stageSentence,
  type ItemStageTimes,
  type StageBreakdown,
} from "@/lib/flow";

/** A list for a sentence: "Review", "Ready and Review", "To do, Ready and Review". */
function listed(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** The waiting statuses that hold time, by name. */
function waitingNames(b: StageBreakdown): string[] {
  return b.stages.filter((s) => s.waiting && s.totalDays > 0).map((s) => s.label);
}

/**
 * The flow efficiency in a sentence, or why there is none yet: too few
 * items (null: the page shows NotEnoughData), or only one kind of status
 * holding time.
 */
export function efficiencySentence(b: StageBreakdown): string | null {
  const e = b.efficiency;
  if (e.reason === "not_enough") return null;
  if (e.reason === "one_kind") {
    return e.waitingDays > 0
      ? "All the time counted is in statuses marked as waiting, so flow efficiency can't be told. Unmark the statuses where the work gets done."
      : "All the time counted is in statuses marked as active, so flow efficiency can't be told yet. Mark the statuses where work mostly sits waiting (Review, if it waits for a reviewer).";
  }
  return `Flow efficiency ${e.pct}%: from start to done, work was in an active status ${e.pct}% of the time and waiting in ${listed(waitingNames(b))} the rest.`;
}

/** An item's bar, read out: "Saved addresses: 9.5 days, In progress 5.5 days, Review 4 days." */
export function barLabel(item: ItemStageTimes): string {
  const parts = item.stages.map((s) => `${STAGE_LABEL[s.stage]} ${stageDuration(s.days)}`);
  return `${item.title}: ${stageDuration(item.elapsedDays)}${parts.length ? `, ${parts.join(", ")}` : ""}.`;
}

/** A table cell: one line, pipes escaped. */
function md(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

/** The export's "Time in each status" section (no lines when no item's moves were recorded). */
export function stageMarkdown(b: StageBreakdown): string[] {
  if (b.items.length === 0 && b.approximate === 0) return [];
  const lines = ["", "## Time in each status", ""];
  if (b.items.length === 0) {
    lines.push(
      `None of the ${b.approximate} finished items has its moves recorded, so the time in each status isn't known.`
    );
    return lines;
  }
  const waiting = new Set<string>(b.waiting);
  lines.push(
    "From the start of work to done, in elapsed time between the board's moves.",
    "",
    stageSentence(b) ?? NO_VALUE,
    "",
    efficiencySentence(b) ??
      `Flow efficiency: ${NO_VALUE} (it needs 3 finished items with their moves recorded).`,
    "",
    "| Status | Items | Median | P85 | Share of the time |",
    "|---|---:|---:|---:|---:|",
    ...b.stages.map(
      (s) =>
        `| ${s.label}${s.waiting ? " (waiting)" : ""} | ${s.items} | ${
          s.median === null ? NO_VALUE : stageDuration(s.median)
        } | ${s.p85 === null ? NO_VALUE : stageDuration(s.p85)} | ${
          s.share === null ? NO_VALUE : `${Math.round(s.share)}%`
        } |`
    ),
    "",
    "| Item | Finished | Time | Active | By status |",
    "|---|---|---:|---:|---|",
    ...[...b.items].reverse().map((it) => {
      const eff = itemEfficiency(it, waiting);
      return `| ${md(it.title)} | ${it.doneOn} | ${stageDuration(it.elapsedDays)} | ${
        eff === null ? NO_VALUE : `${Math.round(eff)}%`
      } | ${it.stages.map((s) => `${STAGE_LABEL[s.stage]} ${stageDuration(s.days)}`).join(", ")} |`;
    })
  );
  if (b.approximate > 0) {
    lines.push(
      "",
      `${b.approximate} more finished ${b.approximate === 1 ? "item has" : "items have"} no recorded moves, so ${
        b.approximate === 1 ? "it is" : "they are"
      } left out here.`
    );
  }
  return lines;
}
