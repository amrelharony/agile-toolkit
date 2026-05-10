import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import type { Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

interface AdkarInitiativeData {
  name: string;
  currentStage:
    | "awareness"
    | "desire"
    | "knowledge"
    | "ability"
    | "reinforcement";
  stagesCompleted: string[];
  owner?: string;
  startDate: string;
  description?: string;
}

export function generateAdkarPrompts(
  data: {
    initiatives: AdkarInitiativeData[];
    perStage: Record<string, number>;
    pctReinforcement: number;
    avgDaysPerStage: number | null;
  },
  workspace?: Workspace | null
): PromptDefinition[] {
  if (data.initiatives.length === 0) return [];
  const wsContext = workspace ? buildWorkspaceContext(workspace) : "";

  const initiativeTable = formatTable(
    [
      "Name",
      "Current stage",
      "Owner",
      "Started",
      "Stages done",
      "Description",
    ],
    data.initiatives.slice(0, 15).map((i) => [
      i.name,
      i.currentStage,
      i.owner ?? "—",
      i.startDate,
      i.stagesCompleted.length,
      (i.description ?? "—").slice(0, 60),
    ])
  );

  return [
    {
      id: "adkar-stuck",
      title: "Stage-stuck diagnosis",
      description:
        "Identify initiatives stuck at a stage and the most likely cause.",
      prompt:
        buildPreamble(
          "ADKAR Change Tracker",
          `${data.initiatives.length} initiatives. ${(
            data.pctReinforcement * 100
          ).toFixed(0)}% reached Reinforcement. Avg days per stage: ${
            data.avgDaysPerStage !== null
              ? data.avgDaysPerStage.toFixed(1) + "d"
              : "n/a"
          }.`
        ) +
        `## Per-stage counts\n\n- Awareness: ${data.perStage.awareness}\n- Desire: ${data.perStage.desire}\n- Knowledge: ${data.perStage.knowledge}\n- Ability: ${data.perStage.ability}\n- Reinforcement: ${data.perStage.reinforcement}\n\n## Initiatives\n\n${initiativeTable}${wsContext}\n\n## Questions\n\n1. Which stage has the largest backlog of initiatives — and what does that imply about org-level change capability?\n2. For each initiative still in Awareness or Desire, what specific intervention would unblock it?\n3. Recommend a 30-day plan for the change-management team based on the distribution.`,
    },
    {
      id: "adkar-reinforcement",
      title: "Reinforcement tactics",
      description:
        "Suggest reinforcement plays so initiatives don't regress after rollout.",
      prompt:
        buildPreamble(
          "ADKAR Change Tracker",
          "Reinforcement is the stage where 60% of change initiatives quietly fail."
        ) +
        `## Initiatives\n\n${initiativeTable}${wsContext}\n\n## Questions\n\n1. For each initiative in Ability or Reinforcement, list 3 reinforcement tactics (recognition, metrics, rituals, escalation paths).\n2. Which initiatives are at highest risk of regression and why?\n3. Draft a 1-page reinforcement playbook this team can apply across initiatives.`,
    },
  ];
}
