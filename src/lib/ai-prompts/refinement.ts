import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable, truncateData } from "./prompt-utils";

interface RefinementData {
  criteria: { id: string; label: string }[];
  history: { storyName: string; passRate: number; checks: Record<string, boolean> }[];
}

export function generateRefinementPrompts(data: RefinementData): PromptDefinition[] {
  if (data.history.length === 0) return [];

  const { data: shown, truncated, totalCount } = truncateData(data.history);
  const table = formatTable(
    ["Story", "Pass Rate", ...data.criteria.map((c) => c.label)],
    shown.map((s) => [s.storyName, `${s.passRate}%`, ...data.criteria.map((c) => s.checks[c.id] ? "✓" : "✗")])
  );
  const note = truncated ? `\n(Showing ${shown.length} of ${totalCount} stories)\n` : "";

  // Find most-failed criteria
  const failRates = data.criteria.map((c) => {
    const failed = data.history.filter((s) => !s.checks[c.id]).length;
    return { label: c.label, failRate: Math.round((failed / data.history.length) * 100) };
  }).sort((a, b) => b.failRate - a.failRate);

  const avgPassRate = Math.round(data.history.reduce((s, h) => s + h.passRate, 0) / data.history.length);

  return [
    {
      id: "refinement-effectiveness",
      title: "Definition of Ready Effectiveness",
      description: "Evaluate whether refinement criteria are adding value and identify weak spots.",
      prompt: buildPreamble("Refinement Checklist", "It tracks whether stories meet a Definition of Ready before entering a sprint.") +
        `## Criteria: ${data.criteria.map((c) => c.label).join(", ")}\n\nAverage pass rate: ${avgPassRate}%\nMost-failed criteria: ${failRates.slice(0, 3).map((f) => `${f.label} (${f.failRate}% fail rate)`).join(", ")}\n\n## Story History\n\n${table}${note}\n\n## Questions\n\n1. Is the average pass rate (${avgPassRate}%) healthy? What target should the team aim for?\n2. Why are ${failRates[0]?.label} and ${failRates[1]?.label} failing most often? What root causes might explain this?\n3. Are any criteria redundant or too strict? Should any be removed or modified?\n4. Are there missing criteria the team should add?\n5. How should the team handle stories that don't fully pass — allow with conditions or block until ready?`,
    },
    {
      id: "refinement-process",
      title: "Refinement Process Improvement",
      description: "Optimize the refinement session format based on historical patterns.",
      prompt: buildPreamble("Refinement Checklist", "Improve the refinement process based on checklist data.") +
        `## Criteria: ${data.criteria.map((c) => c.label).join(", ")}\n\nAverage pass rate: ${avgPassRate}%\n\n## Story History\n\n${table}${note}\n\n## Questions\n\n1. How should the team structure their refinement sessions to improve pass rates?\n2. What template or format would help story authors meet these criteria before refinement?\n3. How much time should the team spend refining each story? Is there a "good enough" threshold?\n4. Create a pre-refinement checklist that story authors can self-assess before the session.\n5. How can the team make refinement engaging rather than a bureaucratic gate?`,
    },
  ];
}
