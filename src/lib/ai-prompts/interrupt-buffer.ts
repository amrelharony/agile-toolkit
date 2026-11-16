import type { PromptDefinition } from "./types";
import { buildPreamble, sanitizePromptCell, wrapUserContent } from "./prompt-utils";

interface InterruptBufferPromptData {
  sprintName: string;
  buffer: string;
  summary: string;
  interrupts: { title: string; kind: string; size?: number; emergency: boolean }[];
  /** Earlier sprints: buffer and use. */
  history: { name: string; bufferPoints: number | null; usedPoints: number; total: number }[];
}

/**
 * Copyable prompts for the Interrupt Buffer: find the sources of the
 * interrupts for the retro, and size the next buffer. Titles are typed by
 * the team, so each is sanitized and the block wrapped as data.
 */
export function generateInterruptBufferPrompts(
  data: InterruptBufferPromptData
): PromptDefinition[] {
  if (data.interrupts.length === 0 && data.history.length === 0) return [];
  const block = wrapUserContent(
    [
      `**Sprint:** ${sanitizePromptCell(data.sprintName, 80)}`,
      `**Buffer:** ${sanitizePromptCell(data.buffer, 120)}`,
      `**Used:** ${sanitizePromptCell(data.summary, 200)}`,
      "",
      "**Interrupts:**",
      ...(data.interrupts.length > 0
        ? data.interrupts
            .slice(0, 30)
            .map(
              (i) =>
                `- ${sanitizePromptCell(i.title, 160)} (${i.kind}${typeof i.size === "number" ? `, ${i.size} pts` : ""}${i.emergency ? ", emergency" : ""})`
            )
        : ["(none logged)"]),
      "",
      "**Earlier sprints:**",
      ...(data.history.length > 0
        ? data.history
            .slice(0, 8)
            .map(
              (h) =>
                `- ${sanitizePromptCell(h.name, 80)}: buffer ${h.bufferPoints ?? "none"}, used ${h.usedPoints} pts in ${h.total} interrupts`
            )
        : ["(none)"]),
    ].join("\n")
  );
  return [
    {
      id: "interrupt-sources",
      title: "Where the interrupts come from",
      description: "Group the interrupts by source and pick one to fix at the retro.",
      prompt:
        buildPreamble("Interrupt Buffer", "Find the sources of the team's unplanned work.") +
        `## Our sprint\n\n${block}\n\n## Questions\n\n1. Group the interrupts by where they came from. Which group costs the most?\n2. For the biggest group, suggest one change that would stop it at the source.\n3. Which interrupts could have waited for the next sprint?`,
    },
    {
      id: "buffer-size",
      title: "Size the next buffer",
      description: "How much to keep free next sprint, from the history.",
      prompt:
        buildPreamble("Interrupt Buffer", "Suggest a buffer for the next sprint.") +
        `## Our sprints\n\n${block}\n\n## Questions\n\n1. From the history, how big should next sprint's buffer be, and why?\n2. What should the team do if the buffer runs out mid-sprint?\n3. What would let us shrink the buffer over the next few sprints?`,
    },
  ];
}
