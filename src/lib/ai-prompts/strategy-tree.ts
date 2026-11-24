import type { PromptDefinition } from "./types";
import { buildPreamble, wrapUserContent } from "./prompt-utils";
import type { Hypothesis, StrategyMap, Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";
import { STRATEGY_FORMATS } from "../strategy-map/formats";
import { renderChecks, renderStrategyMap } from "./impact-map";

/**
 * The strategy tree prompts, for the tree the page has open, in its shape
 * (DIBB, Lean Value Tree, Hoshin Kanri): test the logic from the root
 * down, and find the bets to test first.
 */
export function generateStrategyTreePrompts(
  data: {
    tree: StrategyMap | undefined;
    hypotheses?: readonly Pick<Hypothesis, "id" | "status">[];
  },
  workspace?: Workspace | null
): PromptDefinition[] {
  const { tree } = data;
  if (!tree || tree.nodes.length === 0) return [];
  const format = STRATEGY_FORMATS[tree.format];
  const { text, listed } = renderStrategyMap(tree);
  const more =
    listed < tree.nodes.length ? `\n(Showing ${listed} of ${tree.nodes.length} parts)` : "";
  const body = wrapUserContent(
    `${text}${more}\n\nWhat the page says is missing:\n${renderChecks(tree, data.hypotheses ?? [])}`
  );
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const levels = format.levels.map((l) => l.label).join(" → ");
  const about = `A ${format.label} lays out strategy as a tree you can test: ${levels}. Each part is proposed, agreed, has questions or dropped.`;
  return [
    {
      id: "strategy-tree-logic",
      title: "Check the logic",
      description: "Does each level really follow from the one above it?",
      prompt:
        buildPreamble(format.label, about) +
        `## Tree\n\n${body}${context}\n\n## Questions\n\n1. Where does a part not follow from the one above it?\n2. Which parts are vague or can't be measured? Suggest a measure for each.\n3. What is missing at each level?`,
    },
    {
      id: "strategy-tree-bets",
      title: "Which bet to test first",
      description: "Find the riskiest untested bet and a cheap way to test it.",
      prompt:
        buildPreamble(format.label, about) +
        `## Tree\n\n${body}${context}\n\n## Questions\n\n1. Which untested part, if wrong, would hurt most?\n2. Suggest a small test for it, with a success measure and a time box.\n3. Which parts should be dropped or questioned before more work goes in?`,
    },
  ];
}
