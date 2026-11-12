/**
 * The server half of the example task: the instructions and the user message.
 * Server-only, so the prompt never reaches the browser. The runner adds the
 * scope rule, the guardrail and the JSON-shape line, and wraps `user()` in
 * `<user_content>` tags.
 */

import "server-only";
import { defineAiPrompt } from "../define-task";
import { SUGGEST_OPTIONS_MAX, suggestOptionsTask } from "./_example";

export const suggestOptionsPrompt = defineAiPrompt(suggestOptionsTask, {
  system: [
    "You write the answer options for a quick team poll.",
    `Given the poll question, suggest 2 to ${SUGGEST_OPTIONS_MAX} short, distinct options that cover the answers a team would most likely give.`,
    "Plain words, sentence case, no numbering, no emoji, each option a few words at most.",
    'For a yes-or-no question, include "Not sure".',
  ].join(" "),
  user: ({ question }) => `Poll question: ${question}`,
});
