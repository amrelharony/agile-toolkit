import type { PromptDefinition } from "./types";
import { buildPreamble, sanitizePromptCell, wrapUserContent } from "./prompt-utils";

interface NotesToActionsPromptData {
  meeting: string;
  date: string;
  /** The items kept, never the pasted notes or their quotes. */
  items: { kind: string; text: string; owner?: string; due?: string; status: string }[];
}

/**
 * Copyable prompts for one meeting's follow-ups: a short message to the
 * people who were there, and a check that each action is clear. Built from
 * the kept items only: the pasted notes and their quotes never go in.
 * Each line is sanitised and the block wrapped as data.
 */
export function generateNotesToActionsPrompts(data: NotesToActionsPromptData): PromptDefinition[] {
  if (data.items.length === 0) return [];
  const block = wrapUserContent(
    [
      `**Meeting:** ${sanitizePromptCell(data.meeting || "Not named", 120)} (${data.date})`,
      "",
      "**Follow-ups:**",
      ...data.items
        .slice(0, 50)
        .map(
          (i) =>
            `- ${i.kind}: ${sanitizePromptCell(i.text, 160)}${i.owner ? `, owner ${sanitizePromptCell(i.owner, 60)}` : ""}${i.due ? `, due ${i.due}` : ""} (${i.status})`
        ),
    ].join("\n")
  );
  return [
    {
      id: "notes-follow-up",
      title: "Write the follow-up message",
      description: "A short message for the people who were there.",
      prompt:
        buildPreamble("Notes to Actions", "Write a meeting's follow-up message.") +
        `## Our follow-ups\n\n${block}\n\n## Questions\n\n1. Write a short, friendly follow-up message listing the decisions, then the actions with their owners and dates.\n2. Which open questions should someone answer before the next meeting?`,
    },
    {
      id: "notes-check",
      title: "Check the actions are clear",
      description: "Which actions lack an owner, a date or a clear next step.",
      prompt:
        buildPreamble("Notes to Actions", "Check that a meeting's actions can be done.") +
        `## Our follow-ups\n\n${block}\n\n## Questions\n\n1. Which actions have no owner or no date?\n2. Rewrite any vague action as one clear next step.\n3. Is anything here really a decision or a blocker rather than an action?`,
    },
  ];
}
