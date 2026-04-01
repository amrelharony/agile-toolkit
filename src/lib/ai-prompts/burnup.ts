import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";

interface BurnupData {
  config: { sprintDays: number; sprintStartDate: string };
  entries: { day: number; scope: number | null; completed: number | null }[];
}

export function generateBurnupPrompts(data: BurnupData): PromptDefinition[] {
  const filled = data.entries.filter((e) => e.scope !== null || e.completed !== null);
  if (filled.length === 0) return [];

  const table = formatTable(
    ["Day", "Scope (total)", "Completed"],
    filled.map((e) => [e.day, e.scope ?? "", e.completed ?? ""])
  );

  const lastScope = filled.filter((e) => e.scope !== null).slice(-1)[0]?.scope ?? 0;
  const lastCompleted = filled.filter((e) => e.completed !== null).slice(-1)[0]?.completed ?? 0;
  const scopeChanges = filled.filter((e, i) => i > 0 && e.scope !== null && filled[i - 1]?.scope !== null && e.scope !== filled[i - 1].scope).length;

  const ctx = `Sprint: ${data.config.sprintDays} days | Latest scope: ${lastScope} pts | Latest completed: ${lastCompleted} pts | Scope changes detected: ${scopeChanges}`;

  return [
    {
      id: "burnup-analysis",
      title: "Scope vs Completion Analysis",
      description: "Evaluate whether completed work is keeping pace with scope growth.",
      prompt: buildPreamble("Burnup Chart", "It shows both total scope and completed work over time, making scope creep visible.") +
        `## Context\n\n${ctx}\n\n## Day-by-Day Data\n\n${table}\n\n## Questions\n\n1. Is completed work keeping pace with scope? When will the two lines converge?\n2. How much scope creep has occurred? What is the rate of scope growth vs. completion rate?\n3. At the current velocity, will the team finish within the sprint?\n4. What risks to delivery do you see in this data?\n5. What should the team communicate to stakeholders about this sprint's trajectory?`,
    },
    {
      id: "burnup-scope-creep",
      title: "Scope Creep Detection",
      description: "Analyze scope changes and their impact on delivery predictability.",
      prompt: buildPreamble("Burnup Chart", "Focus on scope stability and its impact on delivery.") +
        `## Context\n\n${ctx}\n\n## Day-by-Day Data\n\n${table}\n\n## Questions\n\n1. Quantify the scope creep: by how many points has scope grown since sprint start?\n2. When did scope changes happen — early, mid, or late sprint? What does the timing tell us?\n3. What policies or agreements could prevent uncontrolled scope growth?\n4. How should the team negotiate scope changes during a sprint?\n5. Draft a brief "scope management protocol" the team can adopt.`,
    },
  ];
}
