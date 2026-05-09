import type { PromptDefinition } from "./types";
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
    data.cards.slice(0, 20).map((c) => [c.title, c.column, c.class, (c.description ?? "—").slice(0, 80)])
  );

  return [
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
        buildPreamble("Kanban Board", "Classes of service shape how cards are prioritized and expedited.") +
        `${inFlight.length} cards in flight.\n\n## Cards\n\n${cardTable}\n\n## Questions\n\n1. Is the team using classes of service meaningfully or defaulting to standard?\n2. Are expedites being abused?\n3. Draft a 1-paragraph policy for each class.`,
    },
  ];
}
