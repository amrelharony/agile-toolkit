import type { Okr, Sprint, SprintGoal, SprintGoalOutcome } from "@/lib/stores/workspace-types";
import { goalSmart, smartMissing, validateSmart, type SmartResult } from "./smart";
import { normalizeQuarter } from "@/lib/roadmap/quarters";
import { krProgressText, okrProgressLabel, resolveLinkedOkrs } from "./okr-links";
import { GOAL_OUTCOME_LABEL, outcomeDate } from "./outcome";
import { goalVerdict } from "./verdict";

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

function smartNote(smart: SmartResult): string {
  const missing = smartMissing(smart);
  const met = 5 - missing.length;
  return missing.length === 0 ? `${met}/5` : `${met}/5, missing ${missing.join(", ")}`;
}

export interface MarkdownContext {
  /** The sprint the goal is for; absent for the draft. */
  sprint?: Pick<Sprint, "id" | "name">;
  /** OKRs the goal's `okrIds` may point at. */
  okrs?: readonly Okr[];
}

type GoalFields = Pick<SprintGoal, "businessObjective" | "goal" | "criteria" | "keyResults"> &
  Partial<Pick<SprintGoal, "okrIds" | "outcome">>;

/** "**Partly met** · recorded 23 Oct 2026", then the note on its own line. */
function outcomeLines(outcome: SprintGoalOutcome): string[] {
  const date = outcomeDate(outcome);
  const label = `**${GOAL_OUTCOME_LABEL[outcome.met]}**`;
  const note = oneLine(outcome.note);
  return [
    "",
    "## Goal met?",
    "",
    date ? `${label} · recorded ${date}` : label,
    ...(note ? ["", `Note: ${note}`] : []),
  ];
}

/** The sprint goal with its SMART checks, criteria and linked OKRs, for a sprint page or a planning thread. */
export function toMarkdown(
  goal: GoalFields,
  now: Date = new Date(),
  { sprint, okrs = [] }: MarkdownContext = {}
): string {
  const title = sprint
    ? `# Sprint Goal — ${oneLine(sprint.name)} · ${mdDate(now)}`
    : `# Sprint Goal — ${mdDate(now)}`;
  const objective = oneLine(goal.businessObjective);
  const text = oneLine(goal.goal);
  const criteria = goal.criteria.filter((c) => c.text.trim());
  const notes = goal.keyResults.map(oneLine).filter(Boolean);
  const { linked } = resolveLinkedOkrs(goal.okrIds, okrs);
  const { outcome } = goal;
  if (
    !objective &&
    !text &&
    criteria.length === 0 &&
    notes.length === 0 &&
    linked.length === 0 &&
    !outcome
  ) {
    return `${title}\n\nNo sprint goal yet.\n`;
  }

  const lines = [title];
  if (text) {
    lines.push(
      "",
      "## Sprint goal",
      "",
      `> ${text}`,
      "",
      `SMART: ${smartNote(goalSmart(goal, sprint))}`
    );
  }
  // Right under the goal it answers: after the sprint, the result comes first.
  if (outcome) lines.push(...outcomeLines(outcome));
  if (objective) lines.push("", "## Business objective", "", objective);
  if (criteria.length > 0) {
    lines.push(
      "",
      "## Acceptance criteria",
      "",
      "| # | Criterion | SMART |",
      "|---:|---|---|",
      ...criteria.map((c, i) => `| ${i + 1} | ${cell(c.text)} | ${smartNote(validateSmart(c))} |`)
    );
  }
  if (linked.length > 0) {
    lines.push("", "## Linked OKRs", "");
    for (const okr of linked) {
      // "Q4 2026" (the old intent's form) reads as the OKR page's "2026 Q4".
      const quarter = oneLine(normalizeQuarter(okr.quarter) || okr.quarter);
      lines.push(
        `- **${oneLine(okr.objective)}** (${quarter ? `${quarter}, ` : ""}${okrProgressLabel(okr)})`,
        ...okr.keyResults.map((kr) => `  - ${oneLine(kr.title)}: ${krProgressText(kr)}`)
      );
    }
  }
  if (notes.length > 0) {
    lines.push("", "## Key-result notes", "", ...notes.map((kr) => `- ${kr}`));
  }
  lines.push("", `**${goalVerdict(goal, sprint)}**`);
  return `${lines.join("\n")}\n`;
}
