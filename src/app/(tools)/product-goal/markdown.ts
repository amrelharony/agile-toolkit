/**
 * The Product Goal as Markdown: the vision, the active goal with its
 * measures and check list, and the earlier goals with how they ended.
 */

import type { ProductGoal } from "@/lib/stores/workspace-types";
import { GOAL_STATUS_LABEL, goalChecks, targetText } from "@/lib/product-goal/model";

const line = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " ").trim();

export function toMarkdown({
  active,
  history,
  vision,
  today,
}: {
  active: ProductGoal | undefined;
  history: readonly ProductGoal[];
  vision: string;
  /** "YYYY-MM-DD". */
  today: string;
}): string {
  const lines = ["# Product Goal", "", `As of ${today}.`, ""];
  if (vision.trim()) lines.push("## Product vision", "", line(vision), "");
  lines.push("## Active goal", "");
  if (!active) {
    lines.push("No Product Goal is active.");
  } else {
    lines.push(`**${line(active.statement)}**`, "");
    if (active.why?.trim()) lines.push(`Why it matters: ${line(active.why)}`, "");
    const target = targetText(active.targetDate);
    if (target) lines.push(`Target: ${target.replace(/^by /, "")}`, "");
    lines.push("Measures:", "");
    if (active.measures.length === 0) lines.push("- None yet.");
    else for (const m of active.measures) lines.push(`- ${line(m)}`);
    lines.push("", "Check list:", "");
    for (const c of goalChecks(active, vision)) {
      const mark = c.met === true ? "[x]" : c.met === false ? "[ ]" : "[?]";
      lines.push(`- ${mark} ${c.label}`);
    }
  }
  lines.push("", "## Earlier goals", "");
  if (history.length === 0) {
    lines.push("None yet.");
  } else {
    for (const g of history) {
      const when = (g.closedAt ?? g.updatedAt).slice(0, 10);
      lines.push(
        `- ${GOAL_STATUS_LABEL[g.status]} ${when}: ${line(g.statement)}${g.note?.trim() ? ` (${line(g.note)})` : ""}`
      );
    }
  }
  return `${lines.join("\n")}\n`;
}
