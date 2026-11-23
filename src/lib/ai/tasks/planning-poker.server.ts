/**
 * Planning Poker's AI task, the server half: the instructions and the user
 * message. The runner adds the scope rule, the guardrail and the JSON shape,
 * and wraps `user()` in `<user_content>`.
 */

import "server-only";
import { defineAiPrompt } from "../define-task";
import { SIMILAR_MATCHES_MAX, pokerSimilarTask } from "./planning-poker";

export const pokerSimilarPrompt = defineAiPrompt(pokerSimilarTask, {
  system: [
    "You help a Scrum Team size a story by finding finished stories that needed similar work.",
    `You get the story and a list of finished stories, each with an id and its points. Pick at most ${SIMILAR_MATCHES_MAX} that are most alike in the work they took (the same part of the product, the same kind of change), most alike first.`,
    "For each pick give its id exactly as listed and a reason of at most a dozen words saying what they have in common.",
    "Pick none when nothing is alike. Never invent an id and never suggest a size: the team decides it. Plain words, no emoji.",
  ].join(" "),
  user: ({ story, candidates }) =>
    [
      `Story: ${story.title}`,
      ...(story.notes ? [`Notes: ${story.notes}`] : []),
      "Finished stories:",
      ...candidates.map((c) => `- id ${c.id} | ${c.points} points | ${c.title}`),
    ].join("\n"),
});
