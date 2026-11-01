import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable, sanitizePromptCell } from "./prompt-utils";
import type { Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";
// The instrument's own scoring (pure, server-safe): the reverse-scored
// statements and the results from five responses read as the page reads them.
import {
  ANOMALY_DROP,
  PSYCH_SAFETY_QUESTIONS,
  ROUND_NAME_MAX,
  coveredLabel,
  questionLabel,
  type RoundComparison,
  type RoundResult,
} from "../psych-safety/instrument";

interface PromptInput {
  /** The round the page shows. */
  roundName: string;
  /** Its results (`roundResult`): null below the minimum responses. */
  result: RoundResult | null;
  /** The round before it, when there is one. */
  previousName?: string;
  /** The two side by side (`compareRounds`): null unless both have results. */
  comparison: RoundComparison | null;
}

const two = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(2));
/** "Q1, Q3 and Q5": the statements the instrument reverse-scores. */
const REVERSED = (() => {
  const ids = PSYCH_SAFETY_QUESTIONS.filter((q) => q.reversed).map((q) => questionLabel(q.id));
  return ids.length > 1
    ? `${ids.slice(0, -1).join(", ")} and ${ids[ids.length - 1]}`
    : ids.join("");
})();
const signed = (n: number | null | undefined) =>
  n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;

/**
 * Prompts for the Psych Safety page, from one round's aggregates: each
 * statement's mean answer and score (the negatively worded ones reverse-scored,
 * as lib/psych-safety/instrument scores them), the team score, and the change
 * per statement since the previous round. Counts and averages only: nothing
 * per person, and no benchmark (the team is compared with its own last round).
 */
export function generatePsychSafetyPrompts(
  data: PromptInput,
  workspace?: Workspace | null
): PromptDefinition[] {
  const { result, comparison: cmp } = data;
  if (!result || result.teamScore === null) return [];
  // Typed by the team: one line, as a table cell would be.
  const roundName = sanitizePromptCell(data.roundName, ROUND_NAME_MAX);
  const previousName =
    data.previousName === undefined
      ? undefined
      : sanitizePromptCell(data.previousName, ROUND_NAME_MAX);
  const wsContext = workspace ? buildWorkspaceContext(workspace) : "";

  const deltaOf = (id: string) => cmp?.perQuestion.find((q) => q.id === id)?.delta ?? null;
  const table = formatTable(
    [
      "Statement",
      "Reverse-scored?",
      "Mean answer",
      "Score (1-5)",
      ...(cmp && previousName ? [`Change since "${previousName}"`] : []),
    ],
    result.perQuestion.map((q) => [
      `${questionLabel(q.id)}. ${q.text.slice(0, 80)}`,
      q.reversed ? "Yes" : "No",
      // A statement with too few answers is withheld, as on the page.
      q.mean === null ? "withheld" : two(q.mean),
      two(q.adjusted),
      ...(cmp && previousName ? [signed(deltaOf(q.id))] : []),
    ])
  );
  const lowest = result.perQuestion.find((q) => q.id === result.lowest);
  const covers = coveredLabel(result);
  const over =
    cmp && cmp.common.length < PSYCH_SAFETY_QUESTIONS.length
      ? ` (over the ${cmp.common.length} statements both rounds show)`
      : "";
  const change = !previousName
    ? " This is the team's first round."
    : !cmp
      ? ` The previous round, "${previousName}", has too few responses to compare.`
      : cmp.delta === null
        ? ` No statement shows in both this round and "${previousName}", so there is no change to report.`
        : ` Change since "${previousName}": ${signed(cmp.delta)}${over}.`;
  const dropped =
    cmp && previousName && cmp.dropped.length > 0
      ? ` Fell by more than ${ANOMALY_DROP} since "${previousName}": ${cmp.dropped.map(questionLabel).join(", ")}.`
      : "";
  const context =
    `Edmondson 7-statement survey, round "${roundName}": team score ${result.teamScore.toFixed(2)}/5${covers ? ` over ${covers} (the others had too few answers to show)` : ""} from ${result.responses} anonymous responses. ${REVERSED} are worded negatively, so their score is 6 minus the mean answer; a higher score is always safer.` +
    change +
    dropped;

  return [
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
}
