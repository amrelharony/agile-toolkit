import type { PromptDefinition } from "./types";
import { buildPreamble, sanitizePromptCell, wrapUserContent } from "./prompt-utils";

interface Node {
  id: string;
  label: string;
  team?: string;
  description?: string;
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
  // R5: every node label / team / description / edge kind is user-typed.
  // Sanitize per-cell, then wrap the composed structured blocks in
  // <user_content> so a determined injector can't close the wrapper.
  const label = (id: string) => sanitizePromptCell(data.nodes.find((n) => n.id === id)?.label ?? id, 80);
  const nodeList = data.nodes
    .map((n) =>
      `- ${sanitizePromptCell(n.label, 80)}${n.team ? ` [${sanitizePromptCell(n.team, 40)}]` : ""}${
        n.description ? ` — ${sanitizePromptCell(n.description, 120)}` : ""
      }`,
    )
    .join("\n");
  const edgeList = data.edges
    .map((e) => `- ${label(e.from)} ${sanitizePromptCell(e.kind, 24)} ${label(e.to)}`)
    .join("\n");
  const criticalText = data.criticalPath.length > 1 ? data.criticalPath.map(label).join(" → ") : "(none)";
  const cycleText =
    data.cycles.length === 0
      ? "None detected."
      : data.cycles.slice(0, 3).map((c) => c.map(label).join(" → ")).join("\n");
  const wrappedNodes = wrapUserContent(nodeList || "(none)");
  const wrappedEdges = wrapUserContent(edgeList || "(none)");

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
        `## Nodes\n\n${wrappedNodes}\n\n## Edges\n\n${wrappedEdges}\n\n## Critical Path\n\n${criticalText}\n\n## Cycles\n\n${cycleText}\n\n## Questions\n\n1. Where is coordination overhead highest?\n2. Which dependencies could be eliminated by splitting work differently?\n3. How should the team sequence work on the critical path?\n4. If cycles exist, propose how to break them.`,
    },
    {
      id: "dep-ownership",
      title: "Cross-Team Coordination",
      description: "Coach on how to coordinate across team boundaries.",
      prompt:
        buildPreamble("Dependency Map", "Cross-team dependencies are the #1 source of delivery delay in scaled Agile.") +
        `## Nodes\n\n${wrappedNodes}\n\n## Edges\n\n${wrappedEdges}\n\n## Questions\n\n1. Who should own the coordination of the critical path?\n2. What rituals (Scrum of Scrums, async sync docs) best fit this shape?\n3. Which dependencies warrant a dedicated integration story?`,
    },
  ];
}
