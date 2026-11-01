import type { KeyResult, Okr, Sprint, SprintGoal } from "@/lib/stores/workspace-types";
import {
  confidenceBand,
  CONFIDENCE_BAND_LABEL,
  isConfidence,
  krBaseline,
  krDirection,
  krPercent,
  krProgressText,
  lastCheckIn,
  objectivePercent,
  okrVerdict,
  sprintGoalsFor,
} from "@/lib/okrs/progress";
import { GOAL_OUTCOME_LABEL } from "@/lib/sprints/goal-doc";
import { fmt, plural } from "@/lib/charts/chart-text";
import { measuredObjectives, measuredProgressPct, quarterKey } from "./view";
import { dayLabel } from "./chart-text";

/** "18 Oct 2026" */
function mdDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** One line of text: newlines collapsed. */
function oneLine(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .trim();
}

/** A table cell: one line, pipes escaped. */
function cell(v: unknown): string {
  return oneLine(v).replace(/\|/g, "\\|");
}

/** "↑ 0 → 60", "↓ 8% → 3%", or "↑ to 60 (no baseline)" for a key result saved before baselines. */
function span(kr: KeyResult): string {
  const unit = kr.unit?.trim() === "%" ? "%" : "";
  const arrow = krDirection(kr) === "decrease" ? "↓" : "↑";
  const base = krBaseline(kr);
  const target = `${fmt(kr.target, 4)}${unit}`;
  return base === null
    ? `${arrow} to ${target} (no baseline)`
    : `${arrow} ${fmt(base, 4)}${unit} → ${target}`;
}

function confidenceCell(kr: KeyResult): string {
  if (!isConfidence(kr.confidence)) return "Not scored";
  const band = confidenceBand(kr.confidence);
  return `${fmt(kr.confidence)}/10${band ? ` (${CONFIDENCE_BAND_LABEL[band]})` : ""}`;
}

export interface OkrLinks {
  sprintGoals: readonly SprintGoal[];
  sprints: readonly Sprint[];
}

/**
 * Objectives with each key result's progress from its baseline, its
 * confidence and its last check-in, the verdict, and the sprint goals that
 * move it, for a quarterly review page.
 */
export function toMarkdown(
  okrs: readonly Okr[],
  now: Date = new Date(),
  links: OkrLinks = { sprintGoals: [], sprints: [] }
): string {
  const title = `# OKRs — ${mdDate(now)}`;
  if (okrs.length === 0) return `${title}\n\nNo objectives yet.\n`;

  const krCount = okrs.reduce((n, o) => n + o.keyResults.length, 0);
  // Only objectives with a key result are measured; the rest are named, never averaged in as 0%.
  const pct = measuredProgressPct(okrs);
  const measured = measuredObjectives(okrs).length;
  const unmeasured = okrs.length - measured;
  const lines = [
    title,
    "",
    pct === null
      ? `**Not measured yet**: ${plural(okrs.length, "objective")}, no key results.`
      : `**${pct}% average progress** across ${plural(measured, "objective")} and ${plural(
          krCount,
          "key result"
        )}${unmeasured > 0 ? `; ${unmeasured} more with no key results yet` : ""}.`,
  ];

  for (const o of okrs) {
    const name = oneLine(o.objective) || "Untitled objective";
    const quarter = quarterKey(o.quarter);
    const reading = o.keyResults.length > 0 ? `${objectivePercent(o)}%` : "not measured yet";
    lines.push("", `## ${name} (${quarter}) — ${reading}`);
    const meta = [o.owner && `Owner: ${oneLine(o.owner)}`, o.description && oneLine(o.description)]
      .filter(Boolean)
      .join(". ");
    if (meta) lines.push("", meta);
    lines.push("", okrVerdict(o, now));
    if (o.keyResults.length > 0) {
      lines.push(
        "",
        "| Key result | Start → target | Now | Progress | Confidence | Last check-in |",
        "|---|---|---|---:|---|---|",
        ...o.keyResults.map((kr) => {
          const last = lastCheckIn(kr);
          return `| ${cell(kr.title) || "Untitled key result"} | ${cell(span(kr))} | ${cell(
            krProgressText(kr)
          )} | ${krPercent(kr)}% | ${confidenceCell(kr)} | ${last ? dayLabel(last.date) : "None yet"} |`;
        })
      );
    }
    const goals = sprintGoalsFor(o.id, links.sprintGoals, links.sprints);
    if (goals.length > 0) {
      lines.push(
        "",
        `Moved by: ${goals
          .map((g) => `${oneLine(g.sprintName)}${g.met ? ` (${GOAL_OUTCOME_LABEL[g.met]})` : ""}`)
          .join(", ")}.`
      );
    }
  }
  return `${lines.join("\n")}\n`;
}
