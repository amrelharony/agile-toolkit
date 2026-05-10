import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import { buildWorkspaceContext } from "./cross-tool-context";
import type { Workspace } from "../stores/workspace-types";

interface DevexResponseData {
  respondent: string;
  date: string;
  flowState: number;
  feedbackLoops: number;
  cognitiveLoad: number;
  comments?: string;
}

/**
 * AI prompts for the DevEx Survey tool.
 *
 * The DevEx framework (Forsgren / Storey 2024) measures three top-level
 * dimensions: Flow State, Feedback Loops, Cognitive Load. The prompts
 * surface friction patterns and concrete improvement bets.
 */
export function generateDevexPrompts(
  data: {
    responses: DevexResponseData[];
    avgFlow: number;
    avgFeedback: number;
    avgCognitive: number;
  },
  workspace?: Workspace | null
): PromptDefinition[] {
  if (data.responses.length === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const recent = data.responses.slice(-25);
  const respTable = formatTable(
    [
      "Date",
      "Respondent",
      "Flow",
      "Feedback",
      "Cog. Load",
      "Comments",
    ],
    recent.map((r) => [
      r.date,
      r.respondent || "anon",
      r.flowState,
      r.feedbackLoops,
      r.cognitiveLoad,
      (r.comments ?? "—").slice(0, 80),
    ])
  );

  return [
    {
      id: "devex-friction",
      title: "Top Friction Points",
      description:
        "Identify the 3 highest-friction themes from response averages and comments.",
      prompt:
        buildPreamble(
          "DevEx Survey",
          `${data.responses.length} response(s). Avg flow ${data.avgFlow.toFixed(2)}/5, feedback ${data.avgFeedback.toFixed(2)}/5, cognitive load ${data.avgCognitive.toFixed(2)}/5 (lower load = better).`
        ) +
        `## Recent responses (up to ${recent.length})\n\n${respTable}\n\n## Questions\n\n1. List the top 3 friction themes from the comments and the score distribution.\n2. Which of the three DevEx dimensions is the team weakest on, and what does the data suggest about why?\n3. What signals would tell us next survey whether the friction has eased?${context}`,
    },
    {
      id: "devex-improvements",
      title: "DevEx Improvement Suggestions",
      description:
        "Recommend a small set of concrete improvements scoped to a 2-week experiment.",
      prompt:
        buildPreamble(
          "DevEx Survey",
          `Avg flow ${data.avgFlow.toFixed(2)}/5, feedback ${data.avgFeedback.toFixed(2)}/5, cognitive load ${data.avgCognitive.toFixed(2)}/5.`
        ) +
        `## Responses\n\n${respTable}\n\n## Questions\n\n1. Suggest 3 concrete improvements (tooling, process, structural) that could be tried as a 2-week experiment.\n2. Order them by likely impact-per-effort.\n3. For each, name the metric or qualitative signal that would prove it worked.${context}`,
    },
  ];
}
