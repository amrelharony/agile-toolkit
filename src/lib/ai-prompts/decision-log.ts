import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import type { Decision } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";
import type { Workspace } from "../stores/workspace-types";

interface DecisionLogData {
  decisions: Decision[];
}

export function generateDecisionLogPrompts(data: DecisionLogData, workspace?: Workspace | null): PromptDefinition[] {
  if (data.decisions.length === 0) return [];
  const context = buildWorkspaceContext(workspace);

  const table = formatTable(
    ["Title", "Status", "Date", "Decision"],
    data.decisions.slice(0, 15).map((d) => [
      d.title || "(untitled)",
      d.status,
      d.date,
      (d.decision || "").slice(0, 80),
    ])
  );

  return [
    {
      id: "adr-review",
      title: "ADR Quality Review",
      description: "Coach on completeness and clarity of your architecture decisions.",
      prompt:
        buildPreamble(
          "Decision Log",
          "Each ADR captures context, decision, consequences, and alternatives considered."
        ) +
        `## Decisions\n\n${table}${context}\n\n## Questions\n\n1. Which ADRs have insufficient context or consequences captured?\n2. Are any decisions clearly superseded but still marked accepted?\n3. What patterns do you see in the team's decision-making?\n4. Suggest 3 improvements to how this team documents decisions.`,
    },
    {
      id: "adr-risk",
      title: "Risk Signals in ADRs",
      description: "Surface decisions that may be creating future risk.",
      prompt:
        buildPreamble(
          "Decision Log",
          "Architectural decisions often lock in future behaviors — some decisions create latent risk."
        ) +
        `## Decisions\n\n${table}${context}\n\n## Questions\n\n1. Which decisions look high-risk (e.g., one-way doors, unclear trade-offs)?\n2. Where is consequence analysis thin or missing?\n3. Are any alternatives rejected too quickly without evidence?\n4. What should the team revisit at the next architecture review?`,
    },
  ];
}
