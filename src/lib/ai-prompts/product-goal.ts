import type { PromptDefinition } from "./types";
import { buildPreamble, sanitizePromptCell, wrapUserContent } from "./prompt-utils";

interface ProductGoalPromptData {
  vision: string;
  statement: string;
  why: string;
  measures: string[];
  /** Backlog story titles, in order. */
  stories: string[];
}

/**
 * Copyable prompts for the Product Goal: test the goal against its check
 * list, and draft measures. Every field is typed by the person, so each is
 * sanitized and the block wrapped as data.
 */
export function generateProductGoalPrompts(data: ProductGoalPromptData): PromptDefinition[] {
  if (!data.statement.trim() && !data.vision.trim()) return [];
  const block = wrapUserContent(
    [
      `**Product vision:** ${sanitizePromptCell(data.vision || "(not written)", 600)}`,
      `**Product Goal:** ${sanitizePromptCell(data.statement || "(not written)", 400)}`,
      `**Why it matters:** ${sanitizePromptCell(data.why || "(not written)", 400)}`,
      "",
      "**Measures:**",
      ...(data.measures.length > 0
        ? data.measures.slice(0, 10).map((m, i) => `${i + 1}. ${sanitizePromptCell(m, 200)}`)
        : ["(none yet)"]),
      "",
      "**Backlog (top stories):**",
      ...(data.stories.length > 0
        ? data.stories.slice(0, 20).map((s) => `- ${sanitizePromptCell(s, 160)}`)
        : ["(empty)"]),
    ].join("\n")
  );
  return [
    {
      id: "goal-check",
      title: "Test the Product Goal",
      description: "Is it an outcome, measurable, one goal, and a step towards the vision?",
      prompt:
        buildPreamble("Product Goal", "Test the Product Goal against what makes a good one.") +
        `## Our Product Goal\n\n${block}\n\n## Questions\n\n1. Is the goal about an outcome for customers or the business, or a list of features? Rewrite it as an outcome if needed.\n2. How would we know it is reached? Suggest two or three measures we can check at each Sprint Review.\n3. Is it one goal? If it holds several, which one matters most now?\n4. Does it move the product towards the vision? Where does it pull away from it?\n5. Which backlog stories don't serve this goal, and should they wait?`,
    },
    {
      id: "goal-measures",
      title: "Measures for the goal",
      description: "Leading and lagging measures, and what each would tell us.",
      prompt:
        buildPreamble("Product Goal", "Suggest how to measure progress towards the Product Goal.") +
        `## Our Product Goal\n\n${block}\n\n## Questions\n\n1. Suggest two leading measures (that move within a sprint or two) and one lagging measure (the outcome itself).\n2. For each, say how we would collect it and what a good target would be.\n3. Which measure could mislead us, and how do we guard against that?`,
    },
  ];
}
