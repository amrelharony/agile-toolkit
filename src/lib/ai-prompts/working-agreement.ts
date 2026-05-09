import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";

interface Rule {
  id: string;
  category: string;
  text: string;
  agreedBy: string[];
  description?: string;
  stillWorking?: boolean;
}

interface CharterMeta {
  teamName?: string;
  version: number;
  publishedAt?: string;
  description?: string;
}

export function generateWorkingAgreementPrompts(data: {
  rules: Rule[];
  meta: CharterMeta;
  adherencePct: number;
}): PromptDefinition[] {
  if (data.rules.length === 0) return [];

  const byCat = new Map<string, number>();
  for (const r of data.rules) byCat.set(r.category, (byCat.get(r.category) ?? 0) + 1);
  const catSummary = Array.from(byCat.entries())
    .map(([c, n]) => `${c}: ${n}`)
    .join(", ");

  const ruleTable = formatTable(
    ["Category", "Rule", "Agreed by", "Still working?"],
    data.rules
      .slice(0, 20)
      .map((r) => [
        r.category,
        r.text.slice(0, 80),
        r.agreedBy.length > 0 ? r.agreedBy.join(", ") : "—",
        r.stillWorking === undefined ? "—" : r.stillWorking ? "yes" : "no",
      ])
  );

  return [
    {
      id: "wa-completeness",
      title: "Charter completeness review",
      description: "Audit gaps across communication, decisions, work norms, and conflict-handling.",
      prompt:
        buildPreamble(
          "Working Agreement Builder",
          `Team "${data.meta.teamName ?? "(unnamed)"}" — version ${data.meta.version}. ${data.rules.length} rules across ${byCat.size} categories (${catSummary}). Latest adherence: ${data.adherencePct.toFixed(0)}%.`
        ) +
        `## Rules\n\n${ruleTable}\n\n## Questions\n\n1. Which categories are under-developed (e.g. no rule covers conflict)?\n2. Are any rules vague or unmeasurable (e.g. "be respectful" with no behavioural anchor)?\n3. Suggest 3-5 missing rules that would round out the charter.\n4. For rules with no \`agreedBy\` names, what would you do to drive explicit commitment?`,
    },
    {
      id: "wa-conflict",
      title: "Conflict-anticipation rules",
      description: "Generate concrete conflict-handling and decision-stalemate rules tailored to this team.",
      prompt:
        buildPreamble(
          "Working Agreement Builder",
          `${data.rules.length} rules currently published. The team has not yet stress-tested the charter against disagreement.`
        ) +
        `## Existing Rules\n\n${ruleTable}\n\n## Questions\n\n1. Where is the charter silent on what happens when people disagree (technical decisions, sprint scope, on-call swaps)?\n2. Propose 3 specific conflict-handling rules with a clear escalation path.\n3. Suggest a decision-rights model (consent / consensus / advice) the team could adopt.\n4. How should the team revisit and renegotiate rules that stop working (note current "still working?" %).`,
    },
  ];
}
