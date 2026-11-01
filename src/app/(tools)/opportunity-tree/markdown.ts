import type { Hypothesis, TreeNode } from "@/lib/stores/workspace-types";
import { linkedTest } from "@/lib/hypotheses/model";
import { nodeTitle } from "@/lib/opportunity-tree/model";
import { sourceLabel } from "@/lib/handoffs/registry";
import { KIND_LABEL, drawTree, kindOf, testLabel, treeVerdict } from "./view";

const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " ").trim();

/** Deeper than this is a hand-edited chain; the page stops drawing there too. */
const MAX_DEPTH = 30;

/**
 * The tree as nested Markdown bullets: each node's kind and text, the
 * target marker, its description and evidence, where it came from, and on
 * an experiment where its hypothesis stands, after the verdict.
 */
export function treeToMarkdown(
  nodes: readonly TreeNode[],
  hypotheses: readonly Pick<Hypothesis, "id" | "status">[]
): string {
  const lines = ["# Opportunity Solution Tree", ""];
  if (nodes.length === 0) {
    lines.push("No outcomes yet.");
    return `${lines.join("\n")}\n`;
  }
  lines.push(`> ${treeVerdict(nodes, hypotheses)}`, "");
  const { roots, childrenOf } = drawTree(nodes);
  const seen = new Set<string>();
  const walk = (n: TreeNode, depth: number) => {
    if (depth > MAX_DEPTH || seen.has(n.id)) return;
    seen.add(n.id);
    const pad = "  ".repeat(depth);
    const kind = kindOf(n);
    const marks = [
      n.target && kind === "opportunity" ? "**target**" : null,
      kind === "experiment" ? testLabel(linkedTest(n.sentTo, hypotheses)) || null : null,
      sourceLabel(n.sourceRef),
    ].filter(Boolean);
    lines.push(
      `${pad}- **${KIND_LABEL[kind]}:** ${oneLine(nodeTitle(n))}${marks.length > 0 ? ` (${marks.join(" · ")})` : ""}`
    );
    if (n.description?.trim()) lines.push(`${pad}  - ${oneLine(n.description)}`);
    if (n.evidence?.trim()) lines.push(`${pad}  - Evidence: ${oneLine(n.evidence)}`);
    for (const c of childrenOf(n.id)) walk(c, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  return `${lines.join("\n")}\n`;
}
