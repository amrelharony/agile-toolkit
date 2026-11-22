/**
 * Facilitator Timers' AI task: draft a timed agenda from a meeting's goal
 * and its length, for the Ceremony Timer's saved agendas. The person
 * reviews every segment before any of it is kept (<AiSuggestions>).
 *
 * This half is the def: schemas with hard caps, a fallback that needs no
 * model (the nearest built-in agenda, split over the minutes, from
 * `facilitator-timers.lite.ts`, which pages import), and a sample input.
 * The prompt lives in `facilitator-timers.server.ts`.
 */

import { z } from "zod";
import { defineAiTask } from "../define-task";
import { AGENDA_MAX_SEGMENTS, agendaFallback } from "./facilitator-timers.lite";

export { AGENDA_MAX_SEGMENTS, agendaFallback } from "./facilitator-timers.lite";

const input = z.object({
  goal: z.string().trim().min(3).max(280),
  minutes: z.number().int().min(5).max(480),
});

const output = z.object({
  title: z.string().trim().min(1).max(80),
  segments: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(60),
        minutes: z.number().min(0.5).max(480),
        hint: z.string().trim().max(200),
      })
    )
    .min(1)
    .max(AGENDA_MAX_SEGMENTS),
});

export type AgendaInput = z.infer<typeof input>;
export type AgendaOutput = z.infer<typeof output>;

export const agendaTask = defineAiTask({
  id: "facilitator-timers.agenda",
  toolId: "facilitator-timers",
  tier: "flash",
  effort: "low",
  maxTokens: 4096,
  input,
  output,
  fallback: agendaFallback,
  sample: { goal: "Agree how we split the checkout rewrite into releases", minutes: 60 },
});
