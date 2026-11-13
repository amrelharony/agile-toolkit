import type { PromptDefinition } from "./types";
import { buildPreamble, sanitizePromptCell, wrapUserContent } from "./prompt-utils";

/**
 * Copyable prompts for Facilitator Timers (the AI Prompts drawer): plan a
 * workshop's timing, and trim a meeting that runs long. The agenda draft
 * goes in as data, sanitised and wrapped; no money, names or rates do.
 */
export function generateFacilitatorTimersPrompts(data: {
  goal: string;
  minutes: number | null;
  segments: { label: string; minutes: number }[];
  pomodoro: { workMinutes: number; breakMinutes: number; rounds: number };
}): PromptDefinition[] {
  const goal = data.goal.trim() ? sanitizePromptCell(data.goal, 200) : "(not set yet)";
  const length = data.minutes ? `${data.minutes} minutes` : "(not set yet)";
  const draft =
    data.segments.length > 0
      ? data.segments
          .map((s, i) => `${i + 1}. ${sanitizePromptCell(s.label, 60)} (${s.minutes} min)`)
          .join("\n")
      : "(no segments yet)";
  const context = `Meeting goal: ${goal}. Length: ${length}. Pomodoro set to ${data.pomodoro.rounds} × ${data.pomodoro.workMinutes} min with ${data.pomodoro.breakMinutes} min breaks.`;

  return [
    {
      id: "ft-workshop-timing",
      title: "Plan the timing of a workshop",
      description: "Breaks, focus blocks and timed rounds for a long session.",
      prompt:
        buildPreamble("Facilitator Timers", context) +
        `## Agenda draft\n\n${wrapUserContent(draft)}\n\n## Your Task\n\nPlan the timing of this session for the facilitator:\n\n1. Where the breaks should go (no more than about 50 minutes without one) and how long each should be.\n2. Which parts suit a focus block, a Crazy 8s round or a timed 1-2-4-All, and for how long.\n3. One sentence on what to do if the session runs 15 minutes late.`,
    },
    {
      id: "ft-trim-meeting",
      title: "Make the meeting shorter",
      description: "Cut a quarter of the time without losing the outcome.",
      prompt:
        buildPreamble("Facilitator Timers", context) +
        `## Agenda draft\n\n${wrapUserContent(draft)}\n\n## Your Task\n\nThe team wants this meeting a quarter shorter. Suggest:\n\n1. Which segments to shorten, merge or move to an async note, and the new minutes for each.\n2. What the facilitator can prepare beforehand to save time in the room.\n3. The one segment that must keep its full time, and why.`,
    },
  ];
}
