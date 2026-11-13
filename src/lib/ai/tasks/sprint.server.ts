/**
 * The Sprint Cockpit's AI task, the server half: the instructions and the
 * user message. The runner adds the scope rule, the guardrail and the JSON
 * shape, and wraps `user()` in `<user_content>`.
 */

import "server-only";
import { defineAiPrompt } from "../define-task";
import { sprintRiskNoteTask } from "./sprint";

const LEVEL_TEXT = { none: "on track", watch: "worth watching", at_risk: "at risk" } as const;

export const sprintRiskNotePrompt = defineAiPrompt(sprintRiskNoteTask, {
  system: [
    "You help a Scrum Master read where a sprint stands against its sprint goal.",
    "You get the facts a rule found: the sprint, its goal, the day, the level (on track, worth watching or at risk) and each reason with one thing to try.",
    "Write 2 or 3 plain sentences in a calm, practical voice: why the goal is at risk (or worth watching), naming the main reason first, and one or two things the team could try this week.",
    "Use only the facts given; never invent numbers, names or events. If the level is on track, say so in one sentence.",
    "No lists, no headings, no Markdown, no emoji.",
  ].join(" "),
  user: (i) =>
    [
      `Sprint: ${i.sprint}`,
      i.goal ? `Sprint goal: ${i.goal}` : "Sprint goal: none written",
      `Day ${i.day} of ${i.length}`,
      `Level: ${LEVEL_TEXT[i.level]}`,
      `Rule's summary: ${i.headline}`,
      i.reasons.length > 0 ? "Reasons:" : "Reasons: none",
      ...i.reasons.map(
        (r, n) => `${n + 1}. (${LEVEL_TEXT[r.level]}) ${r.text} To try: ${r.tryThis}`
      ),
    ].join("\n"),
});
