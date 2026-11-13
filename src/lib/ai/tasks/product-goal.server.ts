/**
 * Product Goal's AI task, the server half: the instructions and the user
 * message. The runner adds the scope rule, the guardrail and the JSON shape,
 * and wraps `user()` in `<user_content>`.
 */

import "server-only";
import { defineAiPrompt } from "../define-task";
import { GOAL_DRAFT_MAX, GOAL_DRAFT_MEASURES_MAX, productGoalDraftTask } from "./product-goal";

export const productGoalDraftPrompt = defineAiPrompt(productGoalDraftTask, {
  system: [
    "You help a Scrum Team's Product Owner write a Product Goal: the one long-term objective the team's sprints work towards.",
    `From the product vision and the backlog's story titles, suggest 1 to ${GOAL_DRAFT_MAX} different candidate goals.`,
    "Each goal is one sentence about an outcome for customers or the business, not a list of features to build, and it is a single objective.",
    "It should move the product towards its vision and be reachable in months, not weeks.",
    `Give each 1 to ${GOAL_DRAFT_MEASURES_MAX} short measures that show progress, and a short line on why it matters.`,
    "If a current goal is given, offer goals that differ from it.",
    "Plain words, sentence case, no emoji, no Markdown.",
  ].join(" "),
  user: ({ vision, stories, current }) =>
    [
      `Product vision: ${vision || "(not written yet)"}`,
      current ? `Current goal: ${current}` : "",
      "Backlog story titles:",
      ...(stories.length > 0 ? stories.map((s) => `- ${s}`) : ["(none yet)"]),
    ]
      .filter(Boolean)
      .join("\n"),
});
