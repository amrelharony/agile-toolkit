/**
 * Test Sessions' AI task, the server half: the instructions and the target
 * as data. The runner adds the scope rule, the guardrail and the JSON shape,
 * and wraps `user()` in `<user_content>`.
 */

import "server-only";
import { defineAiPrompt } from "../define-task";
import { SESSION_MINUTES_MAX, SESSION_MINUTES_MIN } from "@/lib/test-sessions/model";
import { CHARTERS_COUNT_MAX, testSessionsChartersTask } from "./test-sessions";

export const testSessionsChartersPrompt = defineAiPrompt(testSessionsChartersTask, {
  system: [
    "You help a software team plan exploratory test sessions: timed sessions in which a tester explores one part of the product with a clear aim, taking notes as they go.",
    "Suggest charters for the target given. Each charter says what to look at (target), using what (a technique, data, a device, a role or a condition), what the tester wants to learn, a length in whole minutes, and why this one matters, in one short sentence.",
    `Keep each charter to one aim a tester can cover in ${SESSION_MINUTES_MIN} to ${SESSION_MINUTES_MAX} minutes; most take 45 to 90.`,
    "Draw on the details and risks given: edge values, wrong input, interruptions, roles, volume, devices, accessibility, slow networks, dates and time zones, repeats and clashes.",
    "Never repeat a past charter. Plain words, sentence case, no emoji, no Markdown.",
  ].join(" "),
  user: ({ target, details, risks = [], past = [], count = 3 }) =>
    [
      `Suggest ${Math.min(count, CHARTERS_COUNT_MAX)} charters.`,
      `Target: ${target}`,
      details ? `Details:\n${details}` : "",
      risks.length > 0 ? `Risks:\n${risks.map((r) => `- ${r}`).join("\n")}` : "",
      past.length > 0 ? `Past charters to skip:\n${past.map((p) => `- ${p}`).join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
});
