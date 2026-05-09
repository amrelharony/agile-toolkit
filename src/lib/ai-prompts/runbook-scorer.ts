import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";

interface RunbookLite {
  name: string;
  owner?: string;
  freshness: number;
  completeness: number;
  testedRecently: boolean;
  hygiene: number;
  lastReviewedAt?: string;
  description?: string;
}

export function generateRunbookScorerPrompts(data: {
  runbooks: RunbookLite[];
  avgHygiene: number;
  staleCount: number;
  untestedCount: number;
}): PromptDefinition[] {
  if (data.runbooks.length === 0) return [];

  const runbookTable = formatTable(
    [
      "Runbook",
      "Owner",
      "Freshness",
      "Completeness",
      "Tested",
      "Hygiene",
      "Last reviewed",
    ],
    data.runbooks.slice(0, 20).map((r) => [
      r.name,
      r.owner ?? "—",
      r.freshness,
      r.completeness,
      r.testedRecently ? "yes" : "no",
      r.hygiene.toFixed(2),
      r.lastReviewedAt ?? "—",
    ])
  );

  return [
    {
      id: "runbook-hygiene-gaps",
      title: "Runbook hygiene gaps",
      description:
        "Identify the runbooks at greatest risk of failing on-call when needed.",
      prompt:
        buildPreamble(
          "Runbook Maturity Scorer",
          `Avg hygiene: ${data.avgHygiene.toFixed(2)} / 5. Stale runbooks: ${data.staleCount}. Untested: ${data.untestedCount}.`
        ) +
        `## Runbooks\n\n${runbookTable}\n\n## Questions\n\n1. Which runbooks have the worst hygiene and why?\n2. For each top-3 worst runbook, suggest a concrete next step (rewrite, drill, retire).\n3. Recommend a quarterly hygiene cadence for the team.\n4. Identify any pattern (single owner, missing tests, very old reviews) that suggests a structural fix.`,
    },
    {
      id: "triage-prioritization",
      title: "Triage prioritization",
      description:
        "Recommend how to sequence runbook hygiene work given finite team time.",
      prompt:
        buildPreamble(
          "Runbook Maturity Scorer",
          "Hygiene work competes with feature delivery. Sequencing matters."
        ) +
        `## Runbooks\n\n${runbookTable}\n\n## Questions\n\n1. Which runbooks should be addressed first based on impact-weighted risk (untested + stale)?\n2. Estimate effort vs. risk reduction for each of the top 3 candidates.\n3. Recommend a "tested" definition the team should adopt.\n4. Suggest a 2-sprint cleanup plan.`,
    },
  ];
}
