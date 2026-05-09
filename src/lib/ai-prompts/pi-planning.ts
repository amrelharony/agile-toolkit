import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";

interface PiTeam {
  id: string;
  name: string;
  velocity: number;
  description?: string;
}

interface PiItem {
  teamId: string;
  iteration: number;
  title: string;
  points: number;
  kind: "feature" | "dependency" | "risk";
  description?: string;
}

export function generatePiPlanningPrompts(data: {
  teams: PiTeam[];
  items: PiItem[];
  iterations: number;
  overloads: { teamId: string; iteration: number; planned: number; capacity: number }[];
}): PromptDefinition[] {
  if (data.teams.length === 0) return [];
  const teamName = (id: string) => data.teams.find((t) => t.id === id)?.name ?? id;
  const table = formatTable(
    ["Team", "Iteration", "Planned", "Capacity", "%"],
    data.overloads.map((o) => [teamName(o.teamId), o.iteration + 1, o.planned, o.capacity, `${Math.round((o.planned / o.capacity) * 100)}%`])
  );
  const teamTable = formatTable(
    ["Team", "Velocity", "Description"],
    data.teams.map((t) => [t.name, t.velocity, (t.description ?? "—").slice(0, 80)])
  );
  return [
    {
      id: "pi-balance",
      title: "Load Balancing Review",
      description: "Coach on rebalancing work across teams and iterations.",
      prompt:
        buildPreamble("PI Planning Board", "PI planning balances features across team capacity over N iterations.") +
        `## Teams\n\n${teamTable}\n\n## Overloads\n\n${table || "(none)"}\n\n## Questions\n\n1. Which overloads are most severe?\n2. How would you rebalance without slipping commitments?\n3. What's the right contingency buffer for a ${data.iterations}-iteration PI?`,
    },
    {
      id: "pi-risks",
      title: "Dependency & Risk Review",
      description: "Surface hidden risks and cross-team dependencies.",
      prompt:
        buildPreamble("PI Planning Board", "Cross-team dependencies are the top cause of PI failure.") +
        `## Risks/Deps\n\n${data.items.filter((i) => i.kind !== "feature").map((i) => `- [${i.kind}] ${i.title}${i.description ? ` — ${i.description.slice(0, 80)}` : ""} (${teamName(i.teamId)}, iter ${i.iteration + 1})`).join("\n") || "(none tracked)"}\n\n## Questions\n\n1. Which dependencies should be resolved before PI start?\n2. Which risks warrant an owner and mitigation plan?\n3. What's one structural change that would reduce cross-team coupling?`,
    },
  ];
}
