import type { PromptDefinition } from "./types";
import { buildPreamble, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import type { Hypothesis, TreeNode, Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";
import { linkedTest } from "../hypotheses/model";
import {
  KIND_LABEL,
  drawTree,
  kindOf,
  testLabel,
  treeVerdict,
} from "@/app/(tools)/opportunity-tree/view";

/**
 * The tree as the Opportunity Tree page draws it, with the Hypothesis
 * Tracker's list, where each experiment's test stands.
 */
interface TreeData {
  nodes: readonly TreeNode[];
  hypotheses?: readonly Pick<Hypothesis, "id" | "status">[];
}

/** Deeper than this is a hand-edited chain: the page stops drawing there too. */
const MAX_DEPTH = 30;
/** The most nodes listed. */
const MAX_NODES = 200;

/**
 * The tree as an indented list, in the page's order (drawTree: a node
 * whose parent is gone, or one a hand-edited cycle cuts off, is listed at
 * the top rather than lost): each node's kind and text, the target marker
 * on the opportunity the team pursues for its outcome, an experiment's
 * test in the Hypothesis Tracker, and the description and evidence. Every
 * user-typed field is sanitised so a pasted instruction or a
 * triple-backtick block can't break out of the prompt.
 */
function renderTree(
  nodes: readonly TreeNode[],
  hypotheses: readonly Pick<Hypothesis, "id" | "status">[]
): { text: string; listed: number } {
  const { roots, childrenOf } = drawTree(nodes);
  const lines: string[] = [];
  const seen = new Set<string>();
  const walk = (n: TreeNode, depth: number) => {
    if (depth > MAX_DEPTH || seen.has(n.id) || lines.length >= MAX_NODES) return;
    seen.add(n.id);
    const kind = kindOf(n);
    const marks = [
      n.target && kind === "opportunity" ? "target" : "",
      kind === "experiment" ? testLabel(linkedTest(n.sentTo, hypotheses)) || "not tested yet" : "",
    ].filter(Boolean);
    const text = n.text?.trim() ? sanitizePromptCell(n.text, 200) : "(empty)";
    const desc = n.description?.trim() ? ` — ${sanitizePromptCell(n.description, 120)}` : "";
    const ev = n.evidence?.trim() ? ` — evidence: ${sanitizePromptCell(n.evidence, 120)}` : "";
    lines.push(
      `${"  ".repeat(depth)}- [${KIND_LABEL[kind]}] ${text}${marks.length > 0 ? ` (${marks.join("; ")})` : ""}${desc}${ev}`
    );
    for (const c of childrenOf(n.id)) walk(c, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  return { text: lines.join("\n"), listed: lines.length };
}

/**
 * The tree prompts with the page's reading: the verdict (what the team
 * pursues, how many experiments are tested), the target opportunity per
 * outcome, and each experiment's test state from the Hypothesis Tracker.
 */
export function generateOpportunityTreePrompts(
  data: TreeData,
  workspace?: Workspace | null
): PromptDefinition[] {
  const { nodes } = data;
  if (nodes.length === 0) return [];
  const hypotheses = data.hypotheses ?? [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const { text, listed } = renderTree(nodes, hypotheses);
  const more = listed < nodes.length ? `\n(Showing ${listed} of ${nodes.length} nodes)` : "";
  const verdict = `Verdict: ${sanitizePromptCell(treeVerdict(nodes, hypotheses), 400)}`;
  const tree = wrapUserContent(`${verdict}\n\n${text}${more}`);
  const about =
    "An outcome is served by opportunities (customer needs, split into sub-opportunities), their solutions and the experiments that test a solution. A target marks the one opportunity the team pursues for its outcome; an experiment is tested as a hypothesis in the Hypothesis Tracker.";

  return [
    {
      id: "ost-balance",
      title: "Tree Structure Review",
      description:
        "Evaluate whether the tree explores opportunities broadly before narrowing to solutions.",
      prompt:
        buildPreamble(
          "Opportunity Solution Tree",
          `${about} Healthy trees explore many opportunities before committing to solutions.`
        ) +
        `## Tree\n\n${tree}${context}\n\n## Questions\n\n1. Is the team jumping to solutions too fast?\n2. Are opportunities truly customer problems or disguised solutions? Is each target the right one for its outcome?\n3. Where is evidence weak? What should be investigated next?`,
    },
    {
      id: "ost-next-bet",
      title: "Pick the Next Bet",
      description: "Help the team decide which experiment to run next.",
      prompt:
        buildPreamble(
          "Opportunity Solution Tree",
          `${about} Trees should guide you to the riskiest untested assumption.`
        ) +
        `## Tree\n\n${tree}${context}\n\n## Questions\n\n1. Which untested leaf has the highest learning value if tested?\n2. Which solutions are over-engineered for their opportunity?\n3. Given the experiments already tested, recommend the next 2 experiments with rationale.`,
    },
  ];
}
