import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import type { Risk } from "../stores/workspace-types";

export function generateRiskRegisterPrompts(data: { risks: Risk[]; medianTTM: number | null }): PromptDefinition[] {
  if (data.risks.length === 0) return [];
  const sorted = data.risks.slice().sort((a, b) => b.probability * b.impact - a.probability * a.impact);
  const table = formatTable(
    ["Title", "P", "I", "Score", "Status", "Mitigation"],
    sorted.slice(0, 15).map((r) => [r.title || "(untitled)", r.probability, r.impact, r.probability * r.impact, r.status, (r.mitigation ?? "").slice(0, 40)])
  );
  return [
    {
      id: "risk-prioritize",
      title: "Risk Prioritization",
      description: "Rank risks and identify the critical few.",
      prompt:
        buildPreamble("Risk Register", `Median time-to-mitigate: ${data.medianTTM ?? "—"} days.`) +
        `## Top Risks\n\n${table}\n\n## Questions\n\n1. Which 3-5 risks demand immediate attention?\n2. Which risks have weak mitigation plans?\n3. Are any risks better accepted than mitigated?`,
    },
    {
      id: "risk-mitigation",
      title: "Mitigation Plan Review",
      description: "Coach on the quality of mitigation plans.",
      prompt:
        buildPreamble("Risk Register", "Effective mitigations are specific, owned, and time-bound.") +
        `## Risks\n\n${table}\n\n## Questions\n\n1. Which mitigations are vague or unowned?\n2. For the top 3 risks, draft sharper mitigation plans.\n3. What additional risks might we be missing in this domain?`,
    },
  ];
}
