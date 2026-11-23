/**
 * Test Sessions' AI task, the def: suggest up to six charters for
 * exploratory test sessions on one target (a story, or what was typed),
 * from the story's notes, acceptance criteria and Given/When/Then, the risks
 * it names, and past charters to skip. Each charter says what to look at,
 * using what, what to learn, how long (15 to 240 minutes) and why. The
 * person accepts each one, which plans a session through the page's store
 * with Undo; nothing is written by the answer. The tester is never sent.
 *
 * Without AI the ten lenses answer (`fallbackCharters` in
 * `test-sessions.lite.ts`, which pages import). The prompt lives in
 * `test-sessions.server.ts`. At its caps the input is about 10,200
 * characters, well under the request budget even in 3-byte text, so it
 * needs no fitter.
 */

import { z } from "zod";
import { defineAiTask } from "../define-task";
import { SESSION_MINUTES_MAX, SESSION_MINUTES_MIN } from "@/lib/test-sessions/model";
import {
  CHARTERS_COUNT_MAX,
  CHARTERS_DETAILS_MAX,
  CHARTERS_PAST_MAX,
  CHARTERS_PAST_TEXT_MAX,
  CHARTERS_RISKS_MAX,
  CHARTERS_RISK_MAX,
  CHARTERS_TARGET_MAX,
  CHARTERS_TASK_ID,
  CHARTER_LEARN_MAX,
  CHARTER_USING_MAX,
  CHARTER_WHY_MAX,
  fallbackCharters,
} from "./test-sessions.lite";

export {
  CHARTERS_COUNT_MAX,
  CHARTERS_DETAILS_MAX,
  CHARTERS_PAST_MAX,
  CHARTERS_PAST_TEXT_MAX,
  CHARTERS_RISKS_MAX,
  CHARTERS_RISK_MAX,
  CHARTERS_TARGET_MAX,
  CHARTERS_TASK_ID,
  CHARTER_LEARN_MAX,
  CHARTER_USING_MAX,
  CHARTER_WHY_MAX,
  fallbackCharters,
} from "./test-sessions.lite";

const input = z.object({
  target: z.string().trim().min(1).max(CHARTERS_TARGET_MAX),
  details: z.string().trim().max(CHARTERS_DETAILS_MAX).optional(),
  risks: z
    .array(z.string().trim().min(1).max(CHARTERS_RISK_MAX))
    .max(CHARTERS_RISKS_MAX)
    .optional(),
  past: z
    .array(z.string().trim().min(1).max(CHARTERS_PAST_TEXT_MAX))
    .max(CHARTERS_PAST_MAX)
    .optional(),
  count: z.number().int().min(1).max(CHARTERS_COUNT_MAX).optional(),
});

const output = z.object({
  charters: z
    .array(
      z.object({
        target: z.string().trim().min(1).max(CHARTERS_TARGET_MAX),
        using: z.string().trim().min(1).max(CHARTER_USING_MAX),
        toLearn: z.string().trim().min(1).max(CHARTER_LEARN_MAX),
        minutes: z.number().int().min(SESSION_MINUTES_MIN).max(SESSION_MINUTES_MAX),
        why: z.string().trim().min(1).max(CHARTER_WHY_MAX),
      })
    )
    .min(1)
    .max(CHARTERS_COUNT_MAX),
});

export type ChartersInput = z.infer<typeof input>;
export type ChartersOutput = z.infer<typeof output>;
export type CharterSuggestion = ChartersOutput["charters"][number];

export const testSessionsChartersTask = defineAiTask({
  id: CHARTERS_TASK_ID,
  toolId: "test-sessions",
  tier: "flash",
  effort: "low",
  maxTokens: 4096,
  input,
  output,
  fallback: fallbackCharters,
  sample: {
    target: "Saved addresses at checkout",
    details:
      "Shoppers pick a saved address or add a new one. Given a shopper with two saved addresses, when they pick the second, then the delivery price updates.",
    risks: ["Addresses abroad"],
    past: ["Look at saved addresses, using odd, empty and wrong input"],
    count: 3,
  },
});
