import type { PromptDefinition } from "./types";
import { buildPreamble } from "./prompt-utils";

interface Node {
  id: string;
  label: string;
  team?: string;
}

interface Edge {
  from: string;
  to: string;
  kind: string;
}

export function generateDependencyMapPrompts(data: {
  nodes: Node[];
  edges: Edge[];
  cycles: string[][];
  criticalPath: string[];
}): PromptDefinition[] {
  if (data.nodes.length === 0) return [];
  const label = (id: string) => data.nodes.find((n) => n.id === id)?.label ?? id;
  const edgeList = data.edges.map((e) => `- ${label(e.from)} ${e.kind} ${label(e.to)}`).join("\n");
  const criticalText = data.criticalPath.length > 1 ? data.criticalPath.map(label).join(" → ") : "(none)";
  const cycleText =
    data.cycles.length === 0
      ? "None detected."
      : data.cycles.slice(0, 3).map((c) => c.map(label).join(" → ")).join("\n");

  return [
    {
      id: "dep-risk",
      title: "Dependency Risk Assessment",
      description: "Surface risky dependencies and recommend breakdown strategies.",
      prompt:
        buildPreamble(
          "Dependency Map",
          `${data.nodes.length} nodes, ${data.edges.length} edges. Critical path length: ${data.criticalPath.length}.`
        ) +
        `## Edges\n\n${edgeList || "(none)"}\n\n## Critical Path\n\n${criticalText}\n\n## Cycles\n\n${cycleText}\n\n## Questions\n\n1. Where is coordination overhead highest?\n2. Which dependencies could be eliminated by splitting work differently?\n3. How should the team sequence work on the critical path?\n4. If cycles exist, propose how to break them.`,
    },
    {
      id: "dep-ownership",
      title: "Cross-Team Coordination",
      description: "Coach on how to coordinate across team boundaries.",
      prompt:
        buildPreamble("Dependency Map", "Cross-team dependencies are the #1 source of delivery delay in scaled Agile.") +
        `## Edges\n\n${edgeList || "(none)"}\n\n## Questions\n\n1. Who should own the coordination of the critical path?\n2. What rituals (Scrum of Scrums, async sync docs) best fit this shape?\n3. Which dependencies warrant a dedicated integration story?`,
    },
  ];
}
