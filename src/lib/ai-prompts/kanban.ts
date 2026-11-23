import type { PromptDefinition } from "./types";
import type { WorkflowDefinition } from "@/lib/stores/workspace-types";
import { buildPreamble, formatTable } from "./prompt-utils";

interface KCard {
  title: string;
  column: string;
  class: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  description?: string;
}

export function generateKanbanPrompts(data: {
  cards: KCard[];
  wipLimits: Record<string, number>;
  cycleAvg: number;
  cycleP85: number;
  throughputLast7: number;
  /** The Definition of Workflow, when it describes the Flow board. */
  workflow?: WorkflowDefinition | null;
}): PromptDefinition[] {
  if (data.cards.length === 0) return [];
  const inFlight = data.cards.filter((c) => c.column !== "done" && c.column !== "backlog");
  const wipTable = formatTable(
    ["Column", "WIP Limit", "Current"],
    Object.entries(data.wipLimits).map(([col, lim]) => [
      col,
      lim,
      data.cards.filter((c) => c.column === col).length,
    ])
  );
  const cardTable = formatTable(
    ["Title", "Column", "Class", "Description"],
    data.cards
      .slice(0, 20)
      .map((c) => [c.title, c.column, c.class, (c.description ?? "—").slice(0, 80)])
  );

  const workflow = data.workflow;
  const policyTable = workflow
    ? formatTable(
        ["Stage", "Enters when", "Leaves when"],
        (workflow.policies ?? []).map((p) => [p.stage, p.enter ?? "—", p.exit ?? "—"])
      )
    : "";
  const workflowPrompt: PromptDefinition[] = workflow
    ? [
        {
          id: "kanban-workflow",
          title: "Definition of Workflow Review",
          description: "Check the board's written policies against how cards actually flow.",
          prompt:
            buildPreamble(
              "Kanban Board",
              `Our Definition of Workflow. One work item: ${workflow.workItem ?? "not written"}. ${
                workflow.sle
                  ? `SLE: ${workflow.sle.pct}% within ${workflow.sle.days} days.`
                  : "No SLE yet."
              } Cycle P85 is ${data.cycleP85.toFixed(1)}d.`
            ) +
            `## Policies\n\n${policyTable}\n\nWIP policy: ${workflow.wipPolicy ?? "—"}\nPull policy: ${workflow.pullPolicy ?? "—"}\nBlocker policy: ${workflow.blockerPolicy ?? "—"}\n\n## WIP Status\n\n${wipTable}\n\n## Questions\n\n1. Which policy is vague enough that two people would read it differently?\n2. Does the SLE match the P85 we actually see?\n3. Which stage has no exit policy, and what should it be?`,
        },
      ]
    : [];

  return [
    ...workflowPrompt,
    {
      id: "kanban-flow",
      title: "Flow Health Analysis",
      description: "Analyze cycle time, throughput, and WIP balance for flow efficiency.",
      prompt:
        buildPreamble(
          "Kanban Board",
          `Cycle avg ${data.cycleAvg.toFixed(1)}d, P85 ${data.cycleP85.toFixed(1)}d. Throughput last 7 days: ${data.throughputLast7}.`
        ) +
        `## WIP Status\n\n${wipTable}\n\n## Cards\n\n${cardTable}\n\n## Questions\n\n1. Where is flow getting stuck? Which column has disproportionate WIP?\n2. Is the cycle-time distribution acceptable, or is P85 too far from avg (unpredictable)?\n3. Recommend adjustments to WIP limits and class-of-service policies.`,
    },
    {
      id: "kanban-cos",
      title: "Class of Service Policy",
      description: "Evaluate the team's class-of-service policies and escalation paths.",
      prompt:
        buildPreamble(
          "Kanban Board",
          "Classes of service shape how cards are prioritized and expedited."
        ) +
        `${inFlight.length} cards in flight.\n\n## Cards\n\n${cardTable}\n\n## Questions\n\n1. Is the team using classes of service meaningfully or defaulting to standard?\n2. Are expedites being abused?\n3. Draft a 1-paragraph policy for each class.`,
    },
  ];
}
