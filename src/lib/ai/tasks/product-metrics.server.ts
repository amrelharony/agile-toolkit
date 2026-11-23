/**
 * Product Metrics' AI task, the server half: the instructions and the user
 * message. The runner adds the scope rule, the guardrail and the JSON shape,
 * and wraps `user()` in `<user_content>`.
 */

import "server-only";
import { defineAiPrompt } from "../define-task";
import { productMetricsSuggestTask } from "./product-metrics";

const FRAMEWORK_RULES: Record<string, string> = {
  "north-star":
    "Suggest one North Star (role north-star): a count of the value people get from the product that moves before revenue does, and two to four inputs (role input): numbers a team can move within a quarter that drive the North Star.",
  heart:
    "Suggest HEART metrics for the one feature named: one each for happiness, engagement, adoption, retention and task-success (heartCategory), each with a short goal and the signal that shows it. Five at most.",
  aarrr:
    "Suggest one metric for each funnel stage (aarrrStage): acquisition, activation, retention, referral and revenue, each a count of people in a period so the stages can be compared.",
};

export const productMetricsSuggestPrompt = defineAiPrompt(productMetricsSuggestTask, {
  system: [
    "You help a product team choose the numbers their product lives by.",
    "Each metric has a short name (a few words), one plain sentence on what it counts and how, a unit, and whether higher or lower is better (direction).",
    "Prefer counts of what people do or get over page views and vanity totals; never suggest a metric the team already has.",
    "Plain words, sentence case, no emoji, no Markdown.",
  ].join(" "),
  user: ({ framework, product, productGoal, feature, existing }) =>
    [
      `What to suggest: ${FRAMEWORK_RULES[framework] ?? framework}`,
      `The product: ${product}`,
      productGoal ? `Product Goal: ${productGoal}` : "",
      framework === "heart" ? `Feature: ${feature || "(not named)"}` : "",
      "Metrics the team already has:",
      ...(existing.length > 0 ? existing.map((n) => `- ${n}`) : ["(none yet)"]),
    ]
      .filter(Boolean)
      .join("\n"),
});
