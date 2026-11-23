/**
 * Example Mapping's AI prompts (the server half of tasks/example-mapping.ts).
 * The runner adds the scope rule, the guardrail and the JSON shape, and
 * wraps `user()` in <user_content> tags.
 */

import "server-only";
import { defineAiPrompt } from "../define-task";
import {
  EXAMPLE_MAPPING_AI as CAP,
  mapExamplesTask,
  mapQuestionsTask,
  mapRulesTask,
} from "./example-mapping";

const listed = (lines: readonly string[]) =>
  lines.length === 0 ? "(none yet)" : lines.map((l) => `- ${l}`).join("\n");

const PLAIN =
  "Plain sentences in sentence case, no numbering, no emoji, no Markdown. Use concrete names and numbers rather than “a user” or “some items”.";

export const mapRulesPrompt = defineAiPrompt(mapRulesTask, {
  system: [
    "You help a Scrum team run Example Mapping on one user story before they build it.",
    `Suggest up to ${CAP.rulesOut} rules the story must follow: business rules or acceptance criteria, each one short sentence a tester could check. Leave out rules the map already has.`,
    `Also suggest up to ${CAP.questionsOut} questions the team can't answer yet and should find out before building it.`,
    PLAIN,
  ].join(" "),
  user: ({ title, notes, criteria, rules }) =>
    [
      `Story: ${title}`,
      notes ? `Notes:\n${notes}` : "",
      criteria ? `Acceptance criteria:\n${criteria}` : "",
      `Rules on the map so far:\n${listed(rules)}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
});

export const mapExamplesPrompt = defineAiPrompt(mapExamplesTask, {
  system: [
    "You help a Scrum team run Example Mapping: concrete examples that show one rule of a story working, or not.",
    `Suggest up to ${CAP.examplesOut} different examples for the rule given: at least one usual case (kind "happy"), one at the rule's limit ("edge") and one where the rule stops someone ("broken").`,
    'Each has a one-line "text". When the example is clear, also give "given", "when" and "then" (all three, or leave all three out).',
    "Leave out examples the rule already has.",
    PLAIN,
  ].join(" "),
  user: ({ title, rule, examples }) =>
    [`Story: ${title}`, `Rule: ${rule}`, `Examples so far:\n${listed(examples)}`].join("\n\n"),
});

export const mapQuestionsPrompt = defineAiPrompt(mapQuestionsTask, {
  system: [
    "You help a Scrum team run Example Mapping: questions are what nobody in the room can answer yet.",
    `Suggest up to ${CAP.questionsOut} questions that would change how the story is built: gaps between the rules, edge cases no example covers, who decides.`,
    'When a question is about one rule, give that rule\'s id as "ruleId", exactly as given; otherwise leave it out.',
    "Leave out questions the map already asks.",
    PLAIN,
  ].join(" "),
  user: ({ title, rules, questions }) =>
    [
      `Story: ${title}`,
      "Rules (id | rule), each with its examples:",
      rules.length === 0
        ? "(none yet)"
        : rules
            .map((r) => [`${r.id} | ${r.text}`, ...r.examples.map((e) => `  - ${e}`)].join("\n"))
            .join("\n"),
      `Questions so far:\n${listed(questions)}`,
    ].join("\n\n"),
});
