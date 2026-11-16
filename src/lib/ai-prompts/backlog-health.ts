import type { PromptDefinition } from "./types";
import { buildPreamble, sanitizePromptCell, wrapUserContent } from "./prompt-utils";

interface BacklogHealthPromptData {
  score: number | null;
  checks: { label: string; score: number | null; reasons: string[] }[];
  /** The top stories, in backlog order. */
  stories: { title: string; points?: number; flags: string[]; criteria?: string }[];
}

/**
 * Copyable prompts for Backlog Health: plan a refinement around the DEEP
 * scan, and write acceptance criteria for the top stories. Story text is
 * typed by the team, so each field is sanitized and the block wrapped.
 */
export function generateBacklogHealthPrompts(data: BacklogHealthPromptData): PromptDefinition[] {
  if (data.stories.length === 0) return [];
  const block = wrapUserContent(
    [
      `**DEEP score:** ${data.score === null ? "not known" : `${data.score}%`}`,
      ...data.checks.map(
        (c) =>
          `- ${c.label}: ${c.score === null ? "can't tell" : `${Math.round(c.score * 100)}%`} (${c.reasons
            .slice(0, 2)
            .map((r) => sanitizePromptCell(r, 160))
            .join(" ")})`
      ),
      "",
      "**Top stories:**",
      ...data.stories
        .slice(0, 15)
        .map(
          (s, i) =>
            `${i + 1}. ${sanitizePromptCell(s.title, 160)}${typeof s.points === "number" ? ` (${s.points} pts)` : " (no points)"}${s.flags.length ? ` [${s.flags.join(", ")}]` : ""}${s.criteria ? ` — criteria: ${sanitizePromptCell(s.criteria, 200)}` : ""}`
        ),
    ].join("\n")
  );
  return [
    {
      id: "refinement-plan",
      title: "Plan the next refinement",
      description: "Which stories need the team's time first, and what to ask about each.",
      prompt:
        buildPreamble("Backlog Health", "Plan a refinement session from the DEEP scan.") +
        `## Our backlog\n\n${block}\n\n## Questions\n\n1. Which three stories should the team refine first, and why?\n2. For each, what questions should the team answer before it is ready?\n3. Which stories look too big? Suggest how to split each one so every part still delivers something.\n4. Which stories could be dropped?`,
    },
    {
      id: "gwt-criteria",
      title: "Write Given/When/Then criteria",
      description: "Acceptance criteria as scenarios for the top stories.",
      prompt:
        buildPreamble("Backlog Health", "Write acceptance criteria as Given/When/Then scenarios.") +
        `## Our backlog\n\n${block}\n\n## Task\n\nFor each of the first five stories, write two or three scenarios as Given (the situation), When (what someone does), Then (what they can check). Include one scenario for something going wrong.`,
    },
  ];
}
