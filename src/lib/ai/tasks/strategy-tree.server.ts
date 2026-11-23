/**
 * Strategy Tree's AI task, the server half: the instructions and the user
 * message, by the tree's shape. The runner adds the scope rule, the
 * guardrail and the JSON shape, and wraps `user()` in `<user_content>`.
 */

import "server-only";
import { defineAiPrompt } from "../define-task";
import { STRATEGY_FORMATS } from "@/lib/strategy-map/formats";
import {
  TREE_DRAFT_BRANCHES_MAX,
  TREE_DRAFT_CHILDREN_MAX,
  strategyTreeDraftTask,
  type TreeDraftInput,
} from "./strategy-tree";

/** "Insight → Belief → Bet: ..." for the shape's three levels under the root. */
function levelsLine(format: TreeDraftInput["format"]): string {
  const [root, ...below] = STRATEGY_FORMATS[format].levels;
  return [
    `The root is the ${root.label.toLowerCase()}.`,
    ...below.map((l, i) => `Level ${i + 1} is a ${l.label.toLowerCase()}: ${l.hint}`),
  ].join(" ");
}

export const strategyTreeDraftPrompt = defineAiPrompt(strategyTreeDraftTask, {
  system: [
    "You help a product or leadership team lay out strategy as a tree they can test, in one of three shapes: DIBB (data, insight, belief, bet), a Lean Value Tree (vision, goals, bets, initiatives) or Hoshin Kanri (a breakthrough objective, annual objectives, improvement priorities, targets).",
    `Under the root you are given, suggest 1 to ${TREE_DRAFT_BRANCHES_MAX} branches that are not already on the tree, each with up to ${TREE_DRAFT_CHILDREN_MAX} parts under it and up to ${TREE_DRAFT_CHILDREN_MAX} under each of those, following the shape's levels.`,
    "Give a short measure where the level is measured (goals, bets, initiatives, objectives and targets), so each bet can be tested.",
    "Keep every part to one short line. Never name people or owners.",
    "Plain words, sentence case, no emoji, no Markdown.",
  ].join(" "),
  user: ({ format, root, measure, context, existing }) =>
    [
      `Shape: ${STRATEGY_FORMATS[format].label}. ${levelsLine(format)}`,
      `Root: ${root}`,
      measure ? `Root's measure: ${measure}` : "",
      context ? `Context: ${context}` : "",
      "Already on the tree at level 1:",
      ...(existing.length > 0 ? existing.map((e) => `- ${e}`) : ["(none yet)"]),
    ]
      .filter(Boolean)
      .join("\n"),
});
