/**
 * Backlog Health's AI task, the server half: the instructions and the user
 * message. The runner adds the scope rule, the guardrail and the JSON shape,
 * and wraps `user()` in `<user_content>`.
 */

import "server-only";
import { defineAiPrompt } from "../define-task";
import { DEEP_TOP_N, TOO_BIG_POINTS } from "@/lib/backlog/health";
import {
  REVIEW_ANSWERS_MAX,
  REVIEW_GWT_MAX,
  REVIEW_SPLITS_MAX,
  backlogHealthReviewTask,
} from "./backlog-health";

export const backlogHealthReviewPrompt = defineAiPrompt(backlogHealthReviewTask, {
  system: [
    "You review a Scrum Team's product backlog stories before refinement.",
    `Answer only for the stories that need help, at most ${REVIEW_ANSWERS_MAX}, using each story's id exactly as given.`,
    'Flag a story with one or more of: "vague" (the title is too general to build from), "no-criteria" (nothing says how to tell it is done), "too-big" (more than a sprint should take), "unclear-value" (it does not say who gains or why), "not-testable" (its criteria cannot be checked). Give a short reason for each flag.',
    `For a story that is too big, suggest up to ${REVIEW_SPLITS_MAX} smaller story titles that each still deliver something, splitting by path, data, rules, interface or a spike first.`,
    `For a story without good criteria, suggest up to ${REVIEW_GWT_MAX} Given/When/Then scenarios: given the situation, when someone acts, then what they can check.`,
    "Only the top of the backlog needs acceptance criteria: never flag no-criteria, or suggest scenarios for missing criteria, on a story below the top. A story is too big above the points limit given.",
    "Leave splits or scenarios empty when they are not needed. Plain words, sentence case, no emoji, no Markdown.",
  ].join(" "),
  user: ({ stories, topN = DEEP_TOP_N, tooBigPoints = TOO_BIG_POINTS }) =>
    [
      `The top of the backlog: the first ${topN} stories. Too big: more than ${tooBigPoints} points.`,
      "Stories, in backlog order:",
      ...stories.map((s) =>
        [
          `- id: ${s.id}`,
          `  title: ${s.title}`,
          s.points !== undefined ? `  points: ${s.points}` : "  points: none",
          s.description ? `  description: ${s.description}` : "",
          s.criteria ? `  acceptance criteria: ${s.criteria}` : "  acceptance criteria: none",
        ]
          .filter(Boolean)
          .join("\n")
      ),
    ].join("\n"),
});
