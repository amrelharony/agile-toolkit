import type { PromptDefinition } from "./types";
import { buildPreamble, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import type { RlhfPair, Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

export function generateRlhfPrompts(data: { items: RlhfPair[] }, workspace?: Workspace | null): PromptDefinition[] {
  if (data.items.length === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const winA = data.items.filter((x) => x.winner === "A").length;
  const winB = data.items.filter((x) => x.winner === "B").length;
  // Reasons are typed by human reviewers — sanitize each before
  // joining, then wrap each block in `<user_content>` delimiters.
  const reasonsA = wrapUserContent(
    data.items
      .filter((x) => x.winner === "A" && x.reason)
      .slice(0, 5)
      .map((x) => `- ${sanitizePromptCell(x.reason!, 300)}`)
      .join("\n") || "_none_",
  );
  const reasonsB = wrapUserContent(
    data.items
      .filter((x) => x.winner === "B" && x.reason)
      .slice(0, 5)
      .map((x) => `- ${sanitizePromptCell(x.reason!, 300)}`)
      .join("\n") || "_none_",
  );
  return [
    {
      id: "rlhf-pattern",
      title: "Preference Pattern Analysis",
      description: "Find what reviewers consistently prefer, to inform model fine-tuning.",
      prompt:
        buildPreamble("RLHF Feedback Log", "It collects pairwise preference data for model fine-tuning.") +
        `## Wins: A=${winA} · B=${winB} · Ties=${data.items.length - winA - winB}\n\n` +
        `## Reasons A wins\n${reasonsA}\n\n## Reasons B wins\n${reasonsB}\n` + context +
        `\n## Questions\n\n` +
        `1. What attribute(s) consistently determine the winner?\n` +
        `2. Are there inter-reviewer disagreements? How to surface them?\n` +
        `3. Translate the patterns into a refined system prompt the model could learn from.\n` +
        `4. What sample size is needed for statistically meaningful preference signal?\n` +
        `5. Recommend the next 20 prompts to collect to broaden coverage.`,
    },
  ];
}
