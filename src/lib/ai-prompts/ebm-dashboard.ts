import type { PromptDefinition } from "./types";
import { buildPreamble, sanitizePromptCell, wrapUserContent } from "./prompt-utils";

interface EbmPromptData {
  strategicGoal: string;
  productGoal: string;
  sprintGoal: string;
  /** One line per key value area: its name, progress and measures. */
  areas: string[];
  /** The last review in words, or "". */
  lastReview: string;
}

/**
 * Copyable prompts for the EBM Dashboard: read the four key value areas
 * against the goals, and plan the next review. Every field is typed by the
 * person, so each is sanitized and the block wrapped as data.
 */
export function generateEbmDashboardPrompts(data: EbmPromptData): PromptDefinition[] {
  if (!data.strategicGoal.trim() && data.areas.every((a) => !a.trim())) return [];
  const block = wrapUserContent(
    [
      `**Strategic goal:** ${sanitizePromptCell(data.strategicGoal || "(not written)", 600)}`,
      `**Product Goal:** ${sanitizePromptCell(data.productGoal || "(not written)", 400)}`,
      `**This sprint's goal:** ${sanitizePromptCell(data.sprintGoal || "(none)", 300)}`,
      "",
      "**Key value areas:**",
      ...data.areas.slice(0, 4).map((a) => `- ${sanitizePromptCell(a, 800)}`),
      "",
      `**Last review:** ${sanitizePromptCell(data.lastReview || "(none yet)", 600)}`,
    ].join("\n")
  );
  return [
    {
      id: "ebm-read",
      title: "Read the value areas",
      description: "What the evidence says about the value the product delivers.",
      prompt:
        buildPreamble("EBM Dashboard", "Read our evidence across the four key value areas.") +
        `## Our evidence\n\n${block}\n\n## Questions\n\n1. What does each area's evidence say about the value we deliver today and could deliver?\n2. Which area is weakest, and is that a measurement gap or a real gap?\n3. Which measure is missing that would change a decision we face?\n4. Is the strategic goal still the right one, given this evidence?`,
    },
    {
      id: "ebm-experiment",
      title: "Plan the next experiment",
      description: "One small experiment for the area to focus on next.",
      prompt:
        buildPreamble("EBM Dashboard", "Plan one experiment to improve our weakest area.") +
        `## Our evidence\n\n${block}\n\n## Questions\n\n1. Pick the area to focus on next and say why.\n2. Write one hypothesis for it: what we believe, what we'll try, and the measure that would show it worked.\n3. How long should the experiment run, and what would make us stop early?`,
    },
  ];
}
