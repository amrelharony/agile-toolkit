import type { SprintGoal } from "@/lib/stores/workspace-types";
import { validateSmart, type SmartResult } from "./smart";

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

const SMART_LABELS: [keyof SmartResult, string][] = [
  ["specific", "Specific"],
  ["measurable", "Measurable"],
  ["achievable", "Achievable"],
  ["relevant", "Relevant"],
  ["timeBound", "Time-bound"],
];

function smartNote(smart: SmartResult): string {
  const missing = SMART_LABELS.filter(([k]) => !smart[k]).map(([, label]) => label);
  const met = SMART_LABELS.length - missing.length;
  return missing.length === 0 ? `${met}/5` : `${met}/5, missing ${missing.join(", ")}`;
}

/** The sprint goal with its criteria and SMART checks, for a sprint page or a planning thread. */
export function toMarkdown(
  goal: Pick<SprintGoal, "businessObjective" | "goal" | "criteria" | "keyResults">,
  now: Date = new Date()
): string {
  const title = `# Sprint Goal — ${mdDate(now)}`;
  const objective = oneLine(goal.businessObjective);
  const text = oneLine(goal.goal);
  const criteria = goal.criteria.filter((c) => c.text.trim());
  const keyResults = goal.keyResults.map(oneLine).filter(Boolean);
  if (!objective && !text && criteria.length === 0 && keyResults.length === 0) {
    return `${title}\n\nNo sprint goal yet.\n`;
  }

  const lines = [title];
  if (text) lines.push("", "## Sprint goal", "", `> ${text}`);
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
  if (keyResults.length > 0) {
    lines.push("", "## Key results", "", ...keyResults.map((kr) => `- ${kr}`));
  }
  return `${lines.join("\n")}\n`;
}
