import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import type { Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

interface StakeholderData {
  name: string;
  role?: string;
  interest: number;
  authority: number;
  sentiment: "champion" | "supporter" | "neutral" | "skeptic" | "blocker";
  strategy?: string;
  description?: string;
}

interface QuadrantSummary {
  manageClosely: number;
  keepSatisfied: number;
  keepInformed: number;
  monitor: number;
}

export function generateStakeholderMapPrompts(
  data: {
    stakeholders: StakeholderData[];
    quadrants: QuadrantSummary;
    blockers: number;
  },
  workspace?: Workspace | null
): PromptDefinition[] {
  if (data.stakeholders.length === 0) return [];
  const wsContext = workspace ? buildWorkspaceContext(workspace) : "";

  const stakeholderTable = formatTable(
    [
      "Name",
      "Role",
      "Interest",
      "Authority",
      "Sentiment",
      "Strategy",
      "Description",
    ],
    data.stakeholders.slice(0, 20).map((s) => [
      s.name,
      s.role ?? "—",
      s.interest,
      s.authority,
      s.sentiment,
      (s.strategy ?? "—").slice(0, 60),
      (s.description ?? "—").slice(0, 60),
    ])
  );

  const blockerTable =
    data.blockers > 0
      ? formatTable(
          ["Name", "Role", "Authority", "Strategy"],
          data.stakeholders
            .filter((s) => s.sentiment === "blocker")
            .slice(0, 15)
            .map((s) => [s.name, s.role ?? "—", s.authority, s.strategy ?? "—"])
        )
      : "_No blockers logged._";

  return [
    {
      id: "stakeholder-strategy",
      title: "Engagement strategy critique",
      description:
        "Critique each quadrant's engagement plan and surface mismatches.",
      prompt:
        buildPreamble(
          "Stakeholder Map",
          `${data.stakeholders.length} stakeholders. Manage closely: ${data.quadrants.manageClosely}, keep satisfied: ${data.quadrants.keepSatisfied}, keep informed: ${data.quadrants.keepInformed}, monitor: ${data.quadrants.monitor}.`
        ) +
        `## Stakeholders\n\n${stakeholderTable}${wsContext}\n\n## Questions\n\n1. Which stakeholders are misclassified (e.g., a high-authority blocker only being "monitored")?\n2. Are the documented strategies generic or tailored to each person's interest/authority?\n3. Suggest a 2-week engagement plan for the "Manage Closely" quadrant.`,
    },
    {
      id: "stakeholder-blockers",
      title: "Blocker conversion plan",
      description:
        "Propose conversion paths to move blockers and skeptics toward supporters.",
      prompt:
        buildPreamble(
          "Stakeholder Map",
          `${data.blockers} blocker(s) currently logged. Conversion is high-leverage but slow.`
        ) +
        `## Blockers\n\n${blockerTable}\n\n## All stakeholders\n\n${stakeholderTable}${wsContext}\n\n## Questions\n\n1. For each blocker, infer the most likely root cause (lost autonomy, surprise, missed credit, …) and a counter-move.\n2. Which supporter is best positioned to peer-influence each blocker?\n3. What 1-page leadership communication would shift the highest-authority blocker?`,
    },
  ];
}
