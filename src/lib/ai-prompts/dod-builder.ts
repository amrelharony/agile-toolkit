import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";

interface DodItem {
  id: string;
  label: string;
  category: string;
  required: boolean;
}

interface DodData {
  items: DodItem[];
  history: { sprintName: string; completedItemIds: string[] }[];
}

export function generateDodBuilderPrompts(data: DodData): PromptDefinition[] {
  if (data.items.length === 0) return [];
  const table = formatTable(
    ["Category", "Item", "Required"],
    data.items.map((i) => [i.category, i.label, i.required ? "Yes" : "No"])
  );
  return [
    {
      id: "dod-completeness",
      title: "DoD Completeness Review",
      description: "Evaluate whether this DoD is sufficient for shipping production-quality work.",
      prompt:
        buildPreamble("Definition of Done", "The DoD is the shared standard for when a story is truly complete.") +
        `## Current DoD\n\n${table}\n\n## Questions\n\n1. What categories or items are missing that most teams need?\n2. Which optional items should likely be required for this team's context?\n3. Are there overlapping or redundant items?\n4. Suggest 3 specific improvements.`,
    },
    {
      id: "dod-tradeoffs",
      title: "DoD Trade-offs",
      description: "Identify where stricter DoD could slow delivery vs. improve quality.",
      prompt:
        buildPreamble("Definition of Done", "A DoD that's too loose ships bugs; too strict slows delivery.") +
        `## Current DoD\n\n${table}\n\n## Questions\n\n1. Which items are most likely to be skipped under delivery pressure?\n2. What's a pragmatic balance between rigor and speed for this team?\n3. How should the team enforce the DoD without becoming a blocker?`,
    },
  ];
}
