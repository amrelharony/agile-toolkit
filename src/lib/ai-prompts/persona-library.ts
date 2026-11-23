import type { PromptDefinition } from "./types";
import { buildPreamble, sanitizePromptCell, wrapUserContent } from "./prompt-utils";

interface PersonaPromptData {
  /** The saved personas: made-up names, never an interview's participant. */
  personas: {
    name: string;
    role: string;
    tier: string;
    evidence: string;
    goals: string[];
    pains: string[];
    behaviours: string[];
  }[];
}

/**
 * Copyable prompts for the Persona Library: a challenge of the personas and
 * a research plan for the ones that are still a guess. Built from the
 * saved personas only (their made-up names, roles and lists), never from
 * interview notes. Each line is sanitised and the block wrapped as data.
 */
export function generatePersonaLibraryPrompts(data: PersonaPromptData): PromptDefinition[] {
  if (data.personas.length === 0) return [];
  const list = (label: string, items: string[]) =>
    items.length > 0
      ? `  - ${label}: ${items
          .slice(0, 8)
          .map((i) => sanitizePromptCell(i, 120))
          .join("; ")}`
      : `  - ${label}: none yet`;
  const block = wrapUserContent(
    data.personas
      .slice(0, 20)
      .map((p) =>
        [
          `- **${sanitizePromptCell(p.name, 60)}**, ${sanitizePromptCell(p.role, 100)} (${p.tier}; ${p.evidence})`,
          list("Goals", p.goals),
          list("Frustrations", p.pains),
          list("Habits", p.behaviours),
        ].join("\n")
      )
      .join("\n")
  );
  return [
    {
      id: "persona-challenge",
      title: "Challenge our personas",
      description: "Where the personas overlap, contradict each other or read like wishes.",
      prompt:
        buildPreamble("Persona Library", "Review a product team's personas.") +
        `## Our personas\n\n${block}\n\n## Questions\n\n1. Which two personas are so alike they could be one?\n2. Which goals or frustrations sound like features we want to build rather than something the person would say?\n3. Who is missing: someone we serve, or someone we should say the product is not for?`,
    },
    {
      id: "persona-research",
      title: "Plan research for our guesses",
      description: "Questions to ask real people before trusting a persona.",
      prompt:
        buildPreamble("Persona Library", "Plan short interviews to check personas.") +
        `## Our personas\n\n${block}\n\n## Questions\n\n1. For each persona marked as a guess, list three open questions to ask in an interview, without leading the person.\n2. Which of their goals or frustrations would change our plans most if it were wrong?\n3. Who should we talk to first, and how many people before we trust it?`,
    },
  ];
}
