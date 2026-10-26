/**
 * The Psych Safety page's AI prompts, built from a round's results.
 *
 * Local to the tool while lib/ai-prompts/psych-safety.ts still requires
 * an "org benchmark": the tool's 4.0 benchmark was a number with no
 * source, so it is gone, and the prompts compare the round with the
 * team's own previous round instead. Counts and averages only.
 */

import type { PromptDefinition, ToolPromptConfig } from "@/lib/ai-prompts/types";
import { buildPreamble, formatTable } from "@/lib/ai-prompts/prompt-utils";
import { buildWorkspaceContext } from "@/lib/ai-prompts/cross-tool-context";
import type { Workspace } from "@/lib/stores/workspace-types";
import type { RoundComparison, RoundResult } from "@/lib/psych-safety/instrument";

const two = (n: number | null) => (n === null ? "—" : n.toFixed(2));

export function psychSafetyPrompts(
  data: {
    roundName: string;
    result: RoundResult | null;
    previousName?: string;
    comparison: RoundComparison | null;
  },
  workspace?: Workspace | null
): ToolPromptConfig {
  const { result } = data;
  if (!result || result.teamScore === null) {
    return { toolName: "Psychological Safety Assessment", prompts: [] };
  }
  const wsContext = workspace ? buildWorkspaceContext(workspace) : "";
  const deltaOf = (id: string) =>
    data.comparison?.perQuestion.find((q) => q.id === id)?.delta ?? null;
  const table = formatTable(
    [
      "Statement",
      "Reverse-scored?",
      "Mean answer",
      "Score (1-5)",
      ...(data.comparison ? ["Change"] : []),
    ],
    result.perQuestion.map((q) => [
      q.text.slice(0, 80),
      q.reversed ? "Yes" : "No",
      two(q.mean),
      two(q.adjusted),
      ...(data.comparison ? [two(deltaOf(q.id))] : []),
    ])
  );
  const lowest = result.perQuestion.find((q) => q.id === result.lowest);
  const context =
    `Edmondson 7-statement survey, round "${data.roundName}": team score ${result.teamScore.toFixed(2)}/5 from ${result.responses} anonymous responses.` +
    (data.comparison && data.comparison.delta !== null && data.previousName
      ? ` Change since "${data.previousName}": ${data.comparison.delta >= 0 ? "+" : ""}${data.comparison.delta.toFixed(2)}.`
      : "");

  const prompts: PromptDefinition[] = [
    {
      id: "psych-safety-lowest",
      title: "Lowest Dimension Diagnosis",
      description:
        "Diagnose the underlying causes behind the team's weakest psych-safety dimension.",
      prompt:
        buildPreamble("Psychological Safety Assessment", context) +
        `## Per-statement results\n\n${table}\n\n${
          lowest
            ? `## Lowest-scoring statement\n\n"${lowest.text}" — investigate this first.\n\n`
            : ""
        }${wsContext}## Questions\n\n1. What 3 underlying behaviours likely explain the lowest score?\n2. Which leader habits could be amplifying the result, intentionally or not?\n3. Suggest 2 conversation openers a manager can try in the next 1:1 to surface specifics.\n4. What evidence would tell you the score is moving in the right direction?`,
    },
    {
      id: "psych-safety-coaching",
      title: "Coaching Interventions",
      description: "Design 2-week coaching interventions calibrated to the survey results.",
      prompt:
        buildPreamble("Psychological Safety Assessment", context) +
        `## Per-statement results\n\n${table}${wsContext}\n\n## Questions\n\n1. Recommend 3 lightweight rituals (under 30 min/week) to lift the lowest two statements.\n2. For the highest-scoring statement, what's the risk of complacency? How to protect it?\n3. Draft a 2-week coaching plan with weekly check-in prompts and a re-survey trigger.\n4. What anti-patterns should the coach watch for that would signal the interventions are backfiring?`,
    },
  ];
  return { toolName: "Psychological Safety Assessment", prompts };
}
