/**
 * The Cynefin board as Markdown: the verdict, then each domain with its
 * recipe and its problems, each with why it sits there, its plan, the
 * answers it was placed with, and whether it went to the Hypothesis
 * Tracker.
 */

import type { CynefinItem } from "@/lib/stores/workspace-types";
import {
  ANSWER_LABEL,
  DOMAINS,
  DOMAIN_IDS,
  QUESTIONS,
  groupByDomain,
  normalizeAnswers,
  planOf,
  type HypothesisState,
} from "@/lib/cynefin/model";

const line = (s: string) => s.replace(/\s*\n+\s*/g, " ").trim();

export function cynefinToMarkdown(
  items: readonly CynefinItem[],
  {
    verdict,
    hypothesisOf,
  }: { verdict: string; hypothesisOf: (item: CynefinItem) => HypothesisState }
): string {
  const out: string[] = ["# Cynefin board", "", verdict, ""];
  const groups = groupByDomain(items);
  for (const d of DOMAIN_IDS) {
    const list = groups[d];
    if (list.length === 0) continue;
    out.push(`## ${DOMAINS[d].label} (${list.length})`, "", `_${DOMAINS[d].recipe}_`, "");
    for (const it of list) {
      out.push(`- **${line(it.title)}**`);
      if (it.rationale?.trim()) out.push(`  - Why: ${line(it.rationale)}`);
      const plan = planOf(it);
      if (plan.custom) out.push(`  - Plan: ${line(plan.text)}`);
      const a = normalizeAnswers(it.answers);
      const answered = QUESTIONS.filter((q) => a[q.id]);
      if (answered.length > 0) {
        out.push(
          `  - Answers: ${answered.map((q) => `${q.text} ${ANSWER_LABEL[a[q.id]!]}`).join("; ")}`
        );
      }
      const h = hypothesisOf(it);
      if (h !== "none") {
        out.push(
          h === "tested"
            ? "  - Sent to the Hypothesis Tracker: tested."
            : "  - Sent to the Hypothesis Tracker: being tested."
        );
      }
    }
    out.push("");
  }
  return out.join("\n").trimEnd();
}
