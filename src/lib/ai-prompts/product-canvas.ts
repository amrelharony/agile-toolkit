import type { PromptDefinition } from "./types";
import { buildPreamble, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import { productFormat } from "@/lib/product-canvas/formats";
import type { ProductCanvasFormat } from "@/lib/stores/workspace-types";

/** One canvas as the prompts read it: each box's words, by box id. */
export interface ProductCanvasPromptData {
  title: string;
  /** The active Product Goal's statement, or "". */
  goal: string;
  /** Each box's lines (one for a one-line or paragraph box), by box id. */
  boxes: Readonly<Record<string, readonly string[]>>;
}

/**
 * Copyable prompts for one product canvas, from the same builder for every
 * format: walk the format's boxes in order, then ask to fill the empty ones
 * or to challenge the canvas. Every box's words are typed by the team, so
 * each is sanitized and the block wrapped as data. Nothing for a format
 * this build doesn't offer.
 */
export function generateProductCanvasPrompts(
  formatId: ProductCanvasFormat,
  data: ProductCanvasPromptData
): PromptDefinition[] {
  const format = productFormat(formatId);
  if (!format) return [];
  const body: string[] = [
    `**Canvas:** ${sanitizePromptCell(data.title || "(no name)", 200)}`,
    `**Product Goal:** ${sanitizePromptCell(data.goal || "(not written yet)", 400)}`,
  ];
  const empty: string[] = [];
  for (const def of format.sections) {
    const lines = (data.boxes[def.id] ?? []).filter((t) => t.trim()).slice(0, 30);
    if (lines.length === 0) {
      empty.push(def.label);
      continue;
    }
    body.push("", `**${def.label}:**`);
    if (def.kind === "list") body.push(...lines.map((t) => `- ${sanitizePromptCell(t, 200)}`));
    else body.push(sanitizePromptCell(lines[0], def.kind === "long" ? 1000 : 200));
  }
  const block = wrapUserContent(body.join("\n"));
  const boxList = format.sections.map((d, i) => `${i + 1}. ${d.label}: ${d.prompt}`).join("\n");
  const emptyList =
    empty.length > 0 ? empty.map((l) => `- ${l}`).join("\n") : "- (none: every box has something)";
  return [
    {
      id: "canvas-fill",
      title: "Fill the empty boxes",
      description: `Suggest lines for the ${format.name}'s empty boxes, as guesses to check.`,
      prompt:
        buildPreamble(
          "Product Canvas",
          `It is a ${format.name}: one page that describes a product idea.`
        ) +
        `## The boxes\n\n${boxList}\n\n## Our canvas\n\n${block}\n\n## Still empty\n\n${emptyList}\n\n## Questions\n\n1. For each empty box, suggest two or three lines that fit what the rest of the canvas says.\n2. Mark which of your lines are guesses the team should test first.\n3. Say which empty box matters most to fill before the team builds anything.`,
    },
    {
      id: "canvas-challenge",
      title: "Challenge this canvas",
      description: `Find the weak spots of the ${format.name}: guesses, gaps and vague words.`,
      prompt:
        buildPreamble(
          "Product Canvas",
          `It is a ${format.name}: one page that describes a product idea.`
        ) +
        `## Our canvas\n\n${block}\n\n## Questions\n\n1. Which lines are guesses written as facts? How would we test the riskiest one this week?\n2. Where is the language vague or full of buzzwords? Rewrite those lines plainly.\n3. Does the canvas serve the Product Goal? Where does it pull away from it?\n4. What would a sceptical customer or stakeholder ask first, and does the canvas answer it?`,
    },
  ];
}
