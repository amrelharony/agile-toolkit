/**
 * The EBM Dashboard's AI task, the server half: the instructions and the
 * user message. The runner adds the scope rule, the guardrail and the JSON
 * shape, and wraps `user()` in `<user_content>`.
 */

import "server-only";
import { defineAiPrompt } from "../define-task";
import { MEASURES_MAX, ebmMeasuresTask } from "./ebm-dashboard";

/** What each key value area asks, in our own words. */
const AREA_ASK: Record<string, string> = {
  "current-value": "current value: what the product gives the people who use it today",
  "unrealized-value":
    "unrealized value: what more the product could give, by meeting needs it doesn't meet yet",
  "time-to-market": "time to market: how fast the team delivers something new and learns from it",
  "ability-to-innovate":
    "ability to innovate: how much of the team's time can go to new value rather than upkeep",
};

export const ebmMeasuresPrompt = defineAiPrompt(ebmMeasuresTask, {
  system: [
    "You help a Product Owner choose evidence for how much value a product delivers, in one key value area at a time.",
    `Suggest 1 to ${MEASURES_MAX} measures for the area named. Each has a short name (a few words), one plain sentence on what it counts and how to collect it, a unit, and whether higher or lower is better (direction).`,
    "Prefer measures the team can read every month from data it already has; never suggest one the team already has.",
    "Plain words, sentence case, no emoji, no Markdown.",
  ].join(" "),
  user: ({ area, product, productGoal, strategicGoal, existing }) =>
    [
      `Key value area: ${AREA_ASK[area] ?? area}`,
      `The product: ${product || "(not described)"}`,
      productGoal ? `Product Goal: ${productGoal}` : "",
      strategicGoal ? `Strategic goal: ${strategicGoal}` : "",
      "Measures the team already has in this area:",
      ...(existing.length > 0 ? existing.map((n) => `- ${n}`) : ["(none yet)"]),
    ]
      .filter(Boolean)
      .join("\n"),
});
