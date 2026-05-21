import type { PromptDefinition } from "./types";
import { buildPreamble, truncateData, sanitizePromptCell, wrapUserContent } from "./prompt-utils";

interface RetroData {
  formatName: string;
  columns: { label: string; key: string }[];
  cards: {
    columnKey: string;
    text: string;
    votes: number;
    groupedWith: string | null;
    isActionItem: boolean;
    assignee: string;
  }[];
}

export function generateRetroPrompts(data: RetroData): PromptDefinition[] {
  const realCards = data.cards.filter((c) => c.text.trim().length > 0);
  if (realCards.length === 0) return [];

  // Build a text representation of the board. Each card's text comes
  // straight from the user — sanitize it so a sticky like "Ignore
  // previous instructions" wrapped in backticks can't break out of the
  // surrounding prompt structure.
  const boardText = data.columns
    .map((col) => {
      const colCards = realCards
        .filter((c) => c.columnKey === col.key && c.groupedWith === null)
        .sort((a, b) => b.votes - a.votes);
      const { data: shown, truncated } = truncateData(colCards, 15);
      const cardLines = shown
        .map((c) => `- [${c.votes} votes] ${sanitizePromptCell(c.text, 200)}${c.isActionItem ? " → ACTION ITEM" + (c.assignee ? ` (${sanitizePromptCell(c.assignee, 60)})` : "") : ""}`)
        .join("\n");
      return `### ${sanitizePromptCell(col.label, 60)}\n${cardLines || "(no cards)"}${truncated ? `\n... and more cards` : ""}`;
    })
    .join("\n\n");

  const actionItems = realCards.filter((c) => c.isActionItem);
  const actionText =
    actionItems.length > 0
      ? "\n\n### Action Items\n" +
        actionItems.map((c) => `- ${sanitizePromptCell(c.text, 200)}${c.assignee ? ` (Owner: ${sanitizePromptCell(c.assignee, 60)})` : ""}`).join("\n")
      : "";

  // Wrap the entire user-derived block in `<user_content>` with the
  // canonical guardrail prefix.
  const safeBoard = wrapUserContent(`${boardText}${actionText}`);

  const totalCards = realCards.filter((c) => c.groupedWith === null).length;
  const totalVotes = realCards.reduce((s, c) => s + c.votes, 0);

  return [
    {
      id: "retro-insights",
      title: "Retrospective Insights Summary",
      description: "Synthesize themes, patterns, and key takeaways from the retro board.",
      prompt:
        buildPreamble("Retrospective Board", `The team used the "${data.formatName}" format. There are ${totalCards} cards with ${totalVotes} total votes.`) +
        `## Retro Board\n\n${safeBoard}\n\n## Questions\n\n1. What are the top 3 themes emerging across all columns? Group related cards together.\n2. Which items received the most votes? What does the voting pattern reveal about team priorities?\n3. Are there any contradictions or tensions between the columns (e.g., something listed as both positive and a concern)?\n4. Summarize the team's overall sentiment — are they generally positive, struggling, or mixed?\n5. Write a 3-sentence executive summary of this retrospective's findings.`,
    },
    {
      id: "retro-actions",
      title: "Action Item Follow-Up Plan",
      description: "Turn retro outcomes into a concrete improvement plan with owners and deadlines.",
      prompt:
        buildPreamble("Retrospective Board", "Focus on turning retrospective insights into actionable improvements.") +
        `## Retro Board\n\n${safeBoard}\n\n## Questions\n\n1. For each action item, define: specific deliverable, owner, deadline, and how to measure success.\n2. Which action items are quick wins (can be done this sprint) vs. longer-term improvements?\n3. Are there important themes in the retro that DON'T have action items yet? Suggest 2-3 additional actions.\n4. How should the team track progress on these action items? Suggest a lightweight follow-up cadence.\n5. Draft a brief message the Scrum Master could share with the team summarizing commitments from this retro.`,
    },
    {
      id: "retro-dynamics",
      title: "Team Dynamics Analysis",
      description: "Read between the lines to assess team health, morale, and collaboration patterns.",
      prompt:
        buildPreamble("Retrospective Board", "Analyze what the retro cards reveal about team dynamics and morale.") +
        `## Retro Board\n\n${safeBoard}\n\n## Questions\n\n1. What do the cards reveal about team morale? Are there signs of frustration, burnout, or energy?\n2. Are the concerns mostly about process, technology, people, or external factors? What does this distribution suggest?\n3. Do any cards hint at interpersonal tension or collaboration issues? How should the Scrum Master address these?\n4. Is the team reflecting deeply or staying surface-level? How can the facilitator encourage more meaningful reflection?\n5. Based on this retro, what should the Scrum Master focus on in 1:1 conversations this week?`,
    },
  ];
}
