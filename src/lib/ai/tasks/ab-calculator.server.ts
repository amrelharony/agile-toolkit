/**
 * The A/B Calculator's AI task, the server half: the instructions and the
 * test as data. Server-only, so the prompt never reaches the browser. The
 * runner adds the scope rule, the guardrail and the JSON-shape line, and
 * wraps `user()` in `<user_content>` tags.
 */

import "server-only";
import { defineAiPrompt } from "../define-task";
import { abPlanCheckTask } from "./ab-calculator";

export const abPlanCheckPrompt = defineAiPrompt(abPlanCheckTask, {
  system: [
    "You are a product analyst reviewing the plan of a conversion A/B test before it starts.",
    "The test compares a control (A) with one change (B) on one main metric.",
    "Suggest up to 3 guardrail metrics: numbers that should not get worse while the main metric moves, each with a one-sentence reason tied to this test.",
    "Then list up to 4 risks in how the test is planned or read, each one sentence, the most likely first: such as stopping early when it first looks good, running part of a week, a metric that can't tell the versions apart, people seeing both versions, or the split between A and B drifting from even.",
    "Never give a number for the sample size, the length, the rates or the result: the page calculates those.",
    "Plain sentences, no Markdown.",
  ].join(" "),
  user: ({ name, question, metricName, hypothesis }) =>
    [
      `Test: ${name}`,
      question ? `Question: ${question}` : null,
      `Main metric: ${metricName}`,
      hypothesis ? `Hypothesis it tests: ${hypothesis}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
});
