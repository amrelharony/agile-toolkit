/**
 * The Retro board's AI prompts (the server half of tasks/retro.ts). The
 * runner adds the scope rule, the guardrail and the JSON shape, and wraps
 * `user()` in <user_content> tags.
 */

import "server-only";
import { defineAiPrompt } from "../define-task";
import { groupTopicsTask, surprisePlanTask } from "./retro";

export const surprisePlanPrompt = defineAiPrompt(surprisePlanTask, {
  system: [
    "You help a Scrum Master pick a retrospective format that fits the sprint the team is looking back on.",
    "Pick exactly one of the candidate formats, by its id as given, and say in one short paragraph (two or three plain sentences) why it fits this sprint's facts.",
    "Refer to the facts given, never invent numbers, and don't name people. If there are no facts, say what the format will help the team look at.",
    "Sentence case, no lists, no emoji.",
  ].join(" "),
  user: ({ sprint, formats, recent }) =>
    [
      sprint
        ? [
            `Sprint: ${sprint.name}`,
            `Sprint goal: ${sprint.goal}`,
            `Points: ${sprint.completed} of ${sprint.committed} done (say/do ${sprint.sayDo})`,
            `Mood: ${sprint.mood === null ? "not enough check-ins" : `${sprint.mood} of 5`}`,
            `Sprint over: ${sprint.ended ? "yes" : "no"}`,
            sprint.facts.length > 0
              ? `Facts:\n${sprint.facts.map((f) => `- ${f}`).join("\n")}`
              : "",
          ]
            .filter(Boolean)
            .join("\n")
        : "No sprint facts.",
      recent.length > 0 ? `Formats used lately (not candidates): ${recent.join(", ")}` : "",
      "Candidate formats (id | name | columns | description):",
      ...formats.map((f) => `${f.id} | ${f.name} | ${f.columns.join(", ")} | ${f.description}`),
    ]
      .filter(Boolean)
      .join("\n"),
});

export const groupTopicsPrompt = defineAiPrompt(groupTopicsTask, {
  system: [
    "You help a facilitator tidy a Lean Coffee board before the team discusses it.",
    "Group topics that are the same topic or very nearly the same, so the team discusses them once.",
    "Only group topics that clearly belong together; leave the rest out. Each topic is in one group at most, and a group has at least two topics.",
    "Give each group a short title in sentence case, a few words. Use the topic ids exactly as given.",
  ].join(" "),
  user: ({ topics }) =>
    ["Topics (id | votes | topic):", ...topics.map((t) => `${t.id} | ${t.votes} | ${t.text}`)].join(
      "\n"
    ),
});
