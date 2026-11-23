/**
 * Hill Chart's AI task, the def: the week's update for one chart, in plain
 * words, and up to three questions to ask about what is stuck. It only
 * reads positions: the update shows as text to copy, and goes into the
 * chart only if the person saves it as the check-in note.
 *
 * Without AI a template answers (`updateNoteFallback`, in
 * `hill-chart.lite.ts`, which pages import). At its caps the input is about
 * 30 × 200 characters, far under TOOL_AI_BODY_BUDGET even in 3-byte text,
 * so it needs no fitter. The prompt is in `hill-chart.server.ts`.
 */

import { z } from "zod";
import { defineAiTask } from "../define-task";
import {
  UPDATE_QUESTIONS_MAX,
  UPDATE_QUESTION_MAX,
  UPDATE_SCOPES_MAX,
  UPDATE_TEXT_MAX,
  UPDATE_TITLE_MAX,
  updateNoteFallback,
} from "./hill-chart.lite";

export {
  UPDATE_QUESTIONS_MAX,
  UPDATE_QUESTION_MAX,
  UPDATE_SCOPES_MAX,
  UPDATE_TEXT_MAX,
  UPDATE_TITLE_MAX,
  updateNoteFallback,
  updateNoteInput,
} from "./hill-chart.lite";

const Position = z.number().int().min(0).max(100);

const input = z.object({
  title: z.string().trim().min(1).max(UPDATE_TITLE_MAX),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scopes: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(UPDATE_TITLE_MAX),
        position: Position,
        previous: Position.optional(),
        daysSinceMove: z.number().int().min(0).max(3650),
        done: z.boolean(),
      })
    )
    .min(1)
    .max(UPDATE_SCOPES_MAX),
});

const output = z.object({
  update: z.string().trim().min(1).max(UPDATE_TEXT_MAX),
  questions: z.array(z.string().trim().min(1).max(UPDATE_QUESTION_MAX)).max(UPDATE_QUESTIONS_MAX),
});

export type UpdateNoteInput = z.infer<typeof input>;
export type UpdateNoteOutput = z.infer<typeof output>;

export const hillChartUpdateNoteTask = defineAiTask({
  id: "hill-chart.update_note",
  toolId: "hill-chart",
  tier: "flash",
  effort: "low",
  maxTokens: 4096,
  input,
  output,
  fallback: updateNoteFallback,
  sample: {
    title: "Self-service refunds",
    today: "2026-11-23",
    scopes: [
      { title: "Refund rules agreed", position: 80, previous: 60, daysSinceMove: 2, done: false },
      { title: "Payment provider API", position: 30, previous: 30, daysSinceMove: 9, done: false },
      { title: "Email receipts", position: 90, previous: 70, daysSinceMove: 1, done: false },
      { title: "Help text", position: 100, previous: 90, daysSinceMove: 3, done: true },
    ],
  },
});
