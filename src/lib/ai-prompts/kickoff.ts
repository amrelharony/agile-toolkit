import type { PromptDefinition } from "./types";
import {
  buildPreamble,
  sanitizePromptBlock,
  sanitizePromptCell,
  wrapUserContent,
} from "./prompt-utils";
import type { Kickoff } from "../stores/workspace-types";
import { PEOPLE_SECTION } from "../kickoff/formats";
import { formatOf, itemsOf, orderedSliders } from "../kickoff/model";

/** Lines listed per section at most. */
const MAX_LINES = 20;

/**
 * Copyable prompts for one kickoff (the one open on the page): a challenge
 * of what it says, what could go wrong, and the first sprint it points to.
 * Everything typed is user content, so the kickoff is wrapped as data.
 * Names never go: no participant, no owner, and none of the team's people.
 */
export function generateKickoffPrompts(k: Kickoff | null): PromptDefinition[] {
  if (!k) return [];
  const format = formatOf(k);
  const sections = format.sections
    .filter((def) => def.id !== PEOPLE_SECTION)
    .flatMap((def) => {
      const lines = itemsOf(k, def.id)
        .map((i) => i.text.trim())
        .filter(Boolean)
        .slice(0, MAX_LINES);
      if (lines.length === 0) return [];
      return [`${def.label}:\n${lines.map((l) => `- ${sanitizePromptCell(l, 300)}`).join("\n")}`];
    });
  const sliders = orderedSliders(k);
  const block = [
    `Kickoff: ${sanitizePromptCell(k.title, 200)}`,
    k.brief?.trim() ? `Brief: ${sanitizePromptBlock(k.brief, 2000)}` : "",
    ...sections,
    sliders.length > 0
      ? `Trade-offs, from holds firm to gives first: ${sliders
          .map((s) => sanitizePromptCell(s.label, 60))
          .join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const context = `${format.name} with ${sections.length} sections filled in, ${k.status === "agreed" ? "agreed by the team" : "still a draft"}.`;
  const data = `## The kickoff\n\n${wrapUserContent(block)}\n\n`;
  return [
    {
      id: "challenge",
      title: "Challenge the kickoff",
      description: "Find vague lines, gaps and things the team would read differently.",
      prompt:
        buildPreamble("Kickoff tool", context) +
        data +
        "## Questions\n\n1. Which lines are vague enough that two people would read them differently? Suggest sharper wording.\n2. What is missing that a team usually regrets not agreeing at the start?\n3. Where do two lines pull against each other?\n4. What one question should the team answer before it agrees this?",
    },
    {
      id: "what-could-go-wrong",
      title: "What could go wrong",
      description: "Name the risks the kickoff doesn't mention yet, and how to watch for each.",
      prompt:
        buildPreamble("Kickoff tool", context) +
        data +
        "## Questions\n\n1. List five things that could make this work fail that the kickoff doesn't mention.\n2. For each, how likely is it and how bad would it be, on a scale of 1 to 5?\n3. For each, suggest one early sign to watch for and one thing that would make it less likely.",
    },
    {
      id: "first-sprint",
      title: "Plan the first sprint",
      description: "Turn the kickoff into a first Sprint Goal and a handful of stories.",
      prompt:
        buildPreamble("Kickoff tool", context) +
        data +
        "## Questions\n\n1. Suggest a Sprint Goal for the first sprint that moves this kickoff forward.\n2. List up to eight small stories for it, each with one line of acceptance criteria.\n3. Which assumption should the first sprint test, and how?",
    },
  ];
}
