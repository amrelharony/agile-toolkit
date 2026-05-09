import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import type { TechDebtItem } from "../stores/workspace-types";

export function generateTechDebtPrompts(data: { items: TechDebtItem[]; totalInterestPerSprint: number }): PromptDefinition[] {
  if (data.items.length === 0) return [];
  const table = formatTable(
    ["Title", "Area", "Impact", "Effort", "Interest", "Age (d)"],
    data.items.slice(0, 15).map((i) => [
      i.title,
      i.area ?? "",
      i.impact,
      i.effort,
      i.interestRate ?? 0,
      Math.floor((Date.now() - new Date(i.raisedAt).getTime()) / 86_400_000),
    ])
  );
  return [
    {
      id: "debt-paydown",
      title: "Debt Paydown Plan",
      description: "Identify the highest-ROI items to pay down next sprint.",
      prompt:
        buildPreamble("Technical Debt Tracker", `Current interest bleed: ${data.totalInterestPerSprint.toFixed(1)} velocity-units per sprint.`) +
        `## Debt Items\n\n${table}\n\n## Questions\n\n1. Which 3 items give the best paydown ROI this sprint?\n2. What allocation (e.g. 15% of capacity) is appropriate given current interest?\n3. Are there items better left alone (write-offs)?`,
    },
    {
      id: "debt-systemic",
      title: "Systemic Patterns",
      description: "Look for systemic causes behind debt accumulation.",
      prompt:
        buildPreamble("Technical Debt Tracker", "Recurring debt areas point to process or architectural issues.") +
        `## Debt Items\n\n${table}\n\n## Questions\n\n1. What clusters do you see by area?\n2. Is the team accumulating debt faster than paying it down?\n3. Recommend 2-3 process changes to slow debt creation.`,
    },
  ];
}
