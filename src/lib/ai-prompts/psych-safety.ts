import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import type { Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

interface QuestionMeta {
  id: string;
  text: string;
  reversed: boolean;
}

interface PromptInput {
  questions: QuestionMeta[];
  perQuestionAvg: { id: string; avg: number; reversedScore: number }[];
  teamScore: number;
  benchmark: number;
  responseCount: number;
  lowestQuestionId?: string;
  delta?: number;
}

export function generatePsychSafetyPrompts(
  data: PromptInput,
  workspace?: Workspace | null
): PromptDefinition[] {
  if (data.responseCount === 0) return [];
  const wsContext = workspace ? buildWorkspaceContext(workspace) : "";

  const lookup = new Map(data.perQuestionAvg.map((q) => [q.id, q]));
  const table = formatTable(
    ["Question", "Reversed?", "Raw avg", "Adjusted (1-5)"],
    data.questions.map((q) => {
      const m = lookup.get(q.id);
      return [
        q.text.slice(0, 80),
        q.reversed ? "Yes" : "No",
        m ? m.avg.toFixed(2) : "—",
        m ? m.reversedScore.toFixed(2) : "—",
      ];
    })
  );

  const lowest = data.questions.find((q) => q.id === data.lowestQuestionId);

  return [
    {
      id: "psych-safety-lowest",
      title: "Lowest Dimension Diagnosis",
      description:
        "Diagnose the underlying causes behind the team's weakest psych-safety dimension.",
      prompt:
        buildPreamble(
          "Psychological Safety Assessment",
          `Edmondson 7-question survey. Team score ${data.teamScore.toFixed(2)}/5 (org benchmark ${data.benchmark.toFixed(2)}). ${data.responseCount} response(s).${
            data.delta !== undefined
              ? ` Delta vs prior period: ${data.delta >= 0 ? "+" : ""}${data.delta.toFixed(2)}.`
              : ""
          }`
        ) +
        `## Per-question results\n\n${table}\n\n${
          lowest
            ? `## Lowest-scoring item\n\n"${lowest.text}" — investigate this dimension first.\n\n`
            : ""
        }## Questions\n\n1. What 3 underlying behaviours likely explain the lowest score?\n2. Which leader habits could be amplifying the result, intentionally or not?\n3. Suggest 2 conversation openers a manager can try in the next 1:1 to surface specifics.\n4. What evidence would tell you the score is moving in the right direction?` +
        wsContext,
    },
    {
      id: "psych-safety-coaching",
      title: "Coaching Interventions",
      description:
        "Design 2-week coaching interventions calibrated to the survey results.",
      prompt:
        buildPreamble(
          "Psychological Safety Assessment",
          `Team score ${data.teamScore.toFixed(2)}/5 vs org benchmark ${data.benchmark.toFixed(2)}.`
        ) +
        `## Per-question results\n\n${table}\n\n## Questions\n\n1. Recommend 3 lightweight rituals (under 30 min/week) to lift the lowest two dimensions.\n2. For the highest-scoring dimension, what's the risk of complacency? How to protect it?\n3. Draft a 2-week coaching plan with weekly check-in prompts and a re-survey trigger.\n4. What anti-patterns should the coach watch for that would signal the interventions are backfiring?` +
        wsContext,
    },
  ];
}
