import type { PromptDefinition } from "./types";
import { buildPreamble, sanitizePromptCell, wrapUserContent } from "./prompt-utils";

interface HillChartPromptData {
  title: string;
  scopes: {
    title: string;
    position: number;
    side: string;
    daysSinceMove: number;
    stuck: boolean;
  }[];
  /** Check-ins, newest first: the day and its note. */
  checkIns: { day: string; note?: string }[];
}

/**
 * Copyable prompts for a hill chart: the week's status update, and the
 * questions to ask about what is stuck. Titles and notes are typed by the
 * team, so each is sanitized and the block wrapped as data.
 */
export function generateHillChartPrompts(data: HillChartPromptData): PromptDefinition[] {
  if (data.scopes.length === 0) return [];
  const block = wrapUserContent(
    [
      `**Chart:** ${sanitizePromptCell(data.title, 120)}`,
      "",
      "**Scopes** (0–49 still working it out, 50–99 getting it done, 100 done):",
      ...data.scopes
        .slice(0, 30)
        .map(
          (s) =>
            `- ${sanitizePromptCell(s.title, 120)}: ${s.position} (${s.side}), moved ${s.daysSinceMove} days ago${s.stuck ? ", stuck" : ""}`
        ),
      "",
      "**Check-ins:**",
      ...(data.checkIns.length > 0
        ? data.checkIns
            .slice(0, 8)
            .map((c) => `- ${c.day}${c.note ? `: ${sanitizePromptCell(c.note, 200)}` : ""}`)
        : ["(none yet)"]),
    ].join("\n")
  );
  return [
    {
      id: "hill-update",
      title: "Write the week's update",
      description: "A short status update from where the scopes sit on the hill.",
      prompt:
        buildPreamble("Hill Chart", "Write a weekly status update from a hill chart.") +
        `## Our chart\n\n${block}\n\n## Questions\n\n1. Write a three-sentence update for stakeholders: what is over the hill, what moved, what is stuck.\n2. Which scope carries the most unknowns, and why?\n3. What would you tell the team to look at first this week?`,
    },
    {
      id: "hill-stuck",
      title: "Questions for what is stuck",
      description: "What to ask about the scopes that sit uphill.",
      prompt:
        buildPreamble("Hill Chart", "Help a team unstick the work on the uphill side.") +
        `## Our chart\n\n${block}\n\n## Questions\n\n1. For each stuck scope, what questions would uncover what is still unknown?\n2. Which stuck scope could be split so part of it moves over the hill?\n3. Who outside the team might hold the answer?`,
    },
  ];
}
