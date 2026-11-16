/**
 * Interrupt Buffer's AI task, the browser-safe half: read interrupt titles
 * and suggest each one's kind (bug, support, request, incident, other) and
 * a guessed size in points. The person confirms or changes each before it
 * is saved. Without AI, keyword rules answer (lib/sprints/interrupts
 * `classifyInterrupt`). The prompt lives in `interrupt-buffer.server.ts`.
 */

import { z } from "zod";
import { defineAiTask } from "../define-task";
import { INTERRUPT_KINDS } from "@/lib/stores/workspace-types";
import { INTERRUPT_SIZE_MAX, classifyInterrupt } from "@/lib/sprints/interrupts";

export const CLASSIFY_MAX = 20;

const input = z.object({
  titles: z.array(z.string().trim().min(1).max(300)).min(1).max(CLASSIFY_MAX),
});

const output = z.object({
  items: z
    .array(
      z.object({
        /** The title's place in the input, from 0. */
        index: z
          .number()
          .int()
          .min(0)
          .max(CLASSIFY_MAX - 1),
        kind: z.enum(INTERRUPT_KINDS),
        size: z.number().min(0).max(INTERRUPT_SIZE_MAX).optional(),
        reason: z.string().trim().max(160).optional(),
      })
    )
    .max(CLASSIFY_MAX),
});

export type ClassifyInput = z.infer<typeof input>;
export type ClassifyOutput = z.infer<typeof output>;

export const interruptClassifyTask = defineAiTask({
  id: "interrupt-buffer.classify",
  toolId: "interrupt-buffer",
  tier: "flash",
  effort: "low",
  maxTokens: 4096,
  input,
  output,
  fallback: ({ titles }) => ({
    items: titles.map((title, index) => ({ index, ...classifyInterrupt(title) })),
  }),
  sample: {
    titles: [
      "Checkout is down for card payments",
      "Sales asks for a monthly export of refunds",
      "Customer can't reset their password",
    ],
  },
});
