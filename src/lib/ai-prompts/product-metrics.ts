import type { PromptDefinition } from "./types";
import { buildPreamble, sanitizePromptCell, wrapUserContent } from "./prompt-utils";

interface ProductMetricsPromptData {
  /** The active Product Goal's statement, or "". */
  productGoal: string;
  northStar: string;
  inputs: string[];
  /** Each metric as one line: name, latest reading, target. */
  metrics: string[];
  /** The funnel's latest period in words, or "". */
  funnel: string;
}

/**
 * Copyable prompts for Product Metrics: check the North Star and its
 * inputs, and find what the funnel says. Every field is typed by the
 * person, so each is sanitized and the block wrapped as data.
 */
export function generateProductMetricsPrompts(data: ProductMetricsPromptData): PromptDefinition[] {
  if (!data.northStar.trim() && data.metrics.length === 0) return [];
  const block = wrapUserContent(
    [
      `**Product Goal:** ${sanitizePromptCell(data.productGoal || "(not written)", 400)}`,
      `**North Star:** ${sanitizePromptCell(data.northStar || "(not picked)", 200)}`,
      "",
      "**Inputs:**",
      ...(data.inputs.length > 0
        ? data.inputs.slice(0, 5).map((m) => `- ${sanitizePromptCell(m, 200)}`)
        : ["(none yet)"]),
      "",
      "**Metrics (latest reading, target):**",
      ...(data.metrics.length > 0
        ? data.metrics.slice(0, 30).map((m) => `- ${sanitizePromptCell(m, 240)}`)
        : ["(none yet)"]),
      "",
      `**Funnel:** ${sanitizePromptCell(data.funnel || "(no period yet)", 600)}`,
    ].join("\n")
  );
  return [
    {
      id: "north-star-check",
      title: "Test the North Star",
      description: "Does it count value people get, and do the inputs move it?",
      prompt:
        buildPreamble("Product Metrics", "Test our North Star and the inputs that move it.") +
        `## Our metrics\n\n${block}\n\n## Questions\n\n1. Does the North Star count value people get from the product, rather than only money or activity?\n2. Would it move before revenue does? If not, what would?\n3. Can a team change each input within a quarter? Which input is missing?\n4. Which metric here could be gamed, and what would guard against that?`,
    },
    {
      id: "funnel-read",
      title: "Read the funnel",
      description: "Where people drop out, and what to test first.",
      prompt:
        buildPreamble("Product Metrics", "Read our AARRR funnel and suggest what to test.") +
        `## Our metrics\n\n${block}\n\n## Questions\n\n1. Which stage loses the most people, compared with the stage before?\n2. Give three reasons that could explain it, and how we could check each.\n3. Write one hypothesis for a fix, with the number that would show it worked.`,
    },
  ];
}
