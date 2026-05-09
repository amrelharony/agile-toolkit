import type { PromptDefinition } from "./types";
import { buildPreamble } from "./prompt-utils";

interface TreeNode {
  id: string;
  kind: "outcome" | "opportunity" | "solution" | "experiment";
  text: string;
  parentId: string | null;
  evidence?: string;
  description?: string;
}

function renderTree(nodes: TreeNode[], parentId: string | null, depth = 0): string {
  const lines: string[] = [];
  for (const n of nodes.filter((x) => x.parentId === parentId)) {
    const desc = n.description ? ` — ${n.description.slice(0, 80)}` : "";
    const ev = n.evidence ? ` — evidence: ${n.evidence}` : "";
    lines.push(`${"  ".repeat(depth)}- [${n.kind}] ${n.text || "(empty)"}${desc}${ev}`);
    lines.push(renderTree(nodes, n.id, depth + 1));
  }
  return lines.join("\n");
}

export function generateOpportunityTreePrompts(data: { nodes: TreeNode[] }): PromptDefinition[] {
  if (data.nodes.length === 0) return [];
  const tree = renderTree(data.nodes, null);
  return [
    {
      id: "ost-balance",
      title: "Tree Structure Review",
      description: "Evaluate whether the tree explores opportunities broadly before narrowing to solutions.",
      prompt:
        buildPreamble("Opportunity Solution Tree", "Healthy trees explore many opportunities before committing to solutions.") +
        `## Tree\n\n${tree}\n\n## Questions\n\n1. Is the team jumping to solutions too fast?\n2. Are opportunities truly customer problems or disguised solutions?\n3. Where is evidence weak? What should be investigated next?`,
    },
    {
      id: "ost-next-bet",
      title: "Pick the Next Bet",
      description: "Help the team decide which experiment to run next.",
      prompt:
        buildPreamble("Opportunity Solution Tree", "Trees should guide you to the riskiest untested assumption.") +
        `## Tree\n\n${tree}\n\n## Questions\n\n1. Which leaf has the highest learning value if tested?\n2. Which solutions are over-engineered for their opportunity?\n3. Recommend the next 2 experiments with rationale.`,
    },
  ];
}
