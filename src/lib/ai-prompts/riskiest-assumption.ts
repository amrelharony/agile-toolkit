import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import { buildWorkspaceContext } from "./cross-tool-context";
import type { Workspace } from "../stores/workspace-types";

interface Assumption {
  id: string;
  statement: string;
  riskLevel: 1 | 2 | 3 | 4 | 5;
  evidenceLevel: 1 | 2 | 3 | 4 | 5;
  testIdea?: string;
  status: "untested" | "testing" | "validated" | "invalidated";
  description?: string;
}

export function generateRiskiestAssumptionPrompts(
  data: {
    assumptions: Assumption[];
  },
  workspace?: Workspace | null
): PromptDefinition[] {
  if (data.assumptions.length === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";

  const ranked = [...data.assumptions]
    .map((a) => ({ a, score: a.riskLevel * (6 - a.evidenceLevel) }))
    .sort((x, y) => y.score - x.score);

  const table = formatTable(
    ["Statement", "Risk", "Evidence", "Status", "Test idea", "Description"],
    ranked
      .slice(0, 20)
      .map(({ a }) => [
        a.statement.slice(0, 80),
        a.riskLevel,
        a.evidenceLevel,
        a.status,
        (a.testIdea ?? "—").slice(0, 60),
        (a.description ?? "—").slice(0, 80),
      ])
  );

  const untestedHigh = data.assumptions.filter(
    (a) => a.status === "untested" && a.riskLevel >= 4
  ).length;
  const validated = data.assumptions.filter((a) => a.status === "validated").length;
  const invalidated = data.assumptions.filter((a) => a.status === "invalidated").length;

  return [
    {
      id: "ra-ranking",
      title: "Riskiest assumption ranking critique",
      description: "Critique whether the team has correctly ranked assumption risk × evidence.",
      prompt:
        buildPreamble(
          "Riskiest Assumption Canvas",
          `${data.assumptions.length} assumptions logged. ${untestedHigh} untested with risk ≥ 4. ${validated} validated, ${invalidated} invalidated.`
        ) +
        `## Assumptions (sorted by risk × (6 − evidence))\n\n${table}${context}\n\n## Questions\n\n1. Are the top-3 ranked assumptions truly the riskiest, or has the team over-/under-rated specific items?\n2. Which assumptions look conflated (multiple risks bundled into one statement) and should be split?\n3. Are there obvious assumptions the team has missed (e.g. willingness to pay, channel viability, regulatory)?\n4. Recommend the next assumption to test and explain why it dominates the others.`,
    },
    {
      id: "ra-testdesign",
      title: "Test-design coaching",
      description: "Coach the team on designing the cheapest test for each top assumption.",
      prompt:
        buildPreamble(
          "Riskiest Assumption Canvas",
          `Coaching focus: turn the top untested assumptions into the smallest credible experiment.`
        ) +
        `## Top assumptions\n\n${table}${context}\n\n## Questions\n\n1. For each of the top-3 assumptions, propose a test that is ≤ 1 week of effort and produces a clear signal.\n2. Specify the metric, the success threshold, and what an "invalidated" outcome looks like for each.\n3. Where existing test ideas are weak (vague, unmeasurable, or disguised opinion-gathering), say so and rewrite them.\n4. Which assumptions cannot be tested cheaply and therefore require betting (and what would derisk the bet)?`,
    },
  ];
}
