import type { PromptDefinition } from "./types";
import { buildPreamble } from "./prompt-utils";
import type { RlhfPair, Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

export function generateRlhfPrompts(data: { items: RlhfPair[] }, workspace?: Workspace | null): PromptDefinition[] {
  if (data.items.length === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const winA = data.items.filter((x) => x.winner === "A").length;
  const winB = data.items.filter((x) => x.winner === "B").length;
  const reasonsA = data.items.filter((x) => x.winner === "A" && x.reason).slice(0, 5).map((x) => `- ${x.reason}`).join("\n");
  const reasonsB = data.items.filter((x) => x.winner === "B" && x.reason).slice(0, 5).map((x) => `- ${x.reason}`).join("\n");
  return [
    {
      id: "rlhf-pattern",
      title: "Preference Pattern Analysis",
      description: "Find what reviewers consistently prefer, to inform model fine-tuning.",
      prompt:
        buildPreamble("RLHF Feedback Log", "It collects pairwise preference data for model fine-tuning.") +
        `## Wins: A=${winA} · B=${winB} · Ties=${data.items.length - winA - winB}\n\n` +
        `## Reasons A wins\n${reasonsA || "_none_"}\n\n## Reasons B wins\n${reasonsB || "_none_"}\n` + context +
        `\n## Questions\n\n` +
        `1. What attribute(s) consistently determine the winner?\n` +
        `2. Are there inter-reviewer disagreements? How to surface them?\n` +
        `3. Translate the patterns into a refined system prompt the model could learn from.\n` +
        `4. What sample size is needed for statistically meaningful preference signal?\n` +
        `5. Recommend the next 20 prompts to collect to broaden coverage.`,
    },
  ];
}
