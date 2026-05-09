import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";

interface Cause {
  text: string;
  likelihood: number;
  impact: number;
  preventiveAction?: string;
  description?: string;
  owner?: string;
}

export function generatePremortemPrompts(data: { scenario: string; causes: Cause[] }): PromptDefinition[] {
  if (data.causes.length === 0 && !data.scenario) return [];
  const ranked = data.causes.slice().sort((a, b) => b.likelihood * b.impact - a.likelihood * a.impact);
  const table = formatTable(
    ["Cause", "Description", "L", "I", "Score", "Preventive Action", "Owner"],
    ranked.map((c) => [c.text, (c.description ?? "—").slice(0, 80), c.likelihood, c.impact, c.likelihood * c.impact, c.preventiveAction ?? "", c.owner ?? "—"])
  );
  return [
    {
      id: "premortem-expansion",
      title: "Expand the Failure Imagination",
      description: "Surface additional failure causes the team may have missed.",
      prompt:
        buildPreamble(
          "Premortem",
          "Premortems expand the team's imagination of failure before it happens."
        ) +
        `## Scenario\n\n${data.scenario || "(not set)"}\n\n## Causes So Far\n\n${table}\n\n## Questions\n\n1. What failure causes are likely missing (e.g., team dynamics, dependencies, external shocks)?\n2. For each top-ranked cause, what leading indicators would signal it's starting?\n3. Are there "silent killers" — slow-accumulating failures that are easy to ignore?`,
    },
    {
      id: "premortem-actions",
      title: "Preventive Action Plan",
      description: "Turn ranked causes into concrete, owned preventive actions.",
      prompt:
        buildPreamble("Premortem", "Good premortems end with specific owned actions, not just worries.") +
        `## Causes\n\n${table}\n\n## Questions\n\n1. For the top 5 causes, what preventive action has the best cost/benefit ratio?\n2. Who should own each action?\n3. What review cadence keeps these actions alive?`,
    },
  ];
}
