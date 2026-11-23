/**
 * Example Mapping's AI tasks, the defs (prompts in example-mapping.server.ts;
 * pages import `example-mapping.lite.ts`, which holds the fallbacks):
 *
 *   example-mapping.rules     the story (title, notes, criteria) and the
 *                             rules so far → up to 6 rules and 5 questions
 *   example-mapping.examples  the story and one rule → up to 4 concrete
 *                             examples, each happy, edge or broken, with
 *                             Given/When/Then all three or none
 *   example-mapping.questions the story, its rules with a few examples each,
 *                             and the questions so far → up to 5 questions
 *
 * Each fallback needs no model: the story's own criteria and rule words
 * (rules), a usual case, a failure and a limit case (examples), and
 * prompts from the map's shape (questions). The person accepts what fits,
 * into the map, with Undo; nothing is written on its own.
 *
 * Inputs at their caps stay under TOOL_AI_BODY_BUDGET even in 3-byte text
 * (the questions task, the largest, about 58 KB), so no task needs a fitter;
 * test/ai/tasks/example-mapping.test.ts checks it.
 */

import { z } from "zod";
import { defineAiTask, type SchemaOf } from "../define-task";
import {
  EXAMPLE_MAPPING_AI as CAP,
  fallbackExamples,
  fallbackQuestions,
  fallbackRules,
} from "./example-mapping.lite";

export {
  EXAMPLE_MAPPING_AI,
  TEMPLATE_QUESTIONS,
  fallbackExamples,
  fallbackQuestions,
  fallbackRules,
  keepKnownRules,
} from "./example-mapping.lite";

const Line = (max: number) => z.string().trim().max(max);

/* ── example-mapping.rules ──────────────────────────────────────────── */

const rulesInput = z.object({
  title: Line(CAP.text).min(1),
  notes: Line(CAP.notes),
  criteria: Line(CAP.notes),
  rules: z.array(Line(CAP.text)).max(CAP.rules),
});

const rulesOutput = z.object({
  rules: z.array(z.object({ text: Line(CAP.text).min(1) })).max(CAP.rulesOut),
  questions: z.array(z.object({ text: Line(CAP.text).min(1) })).max(CAP.questionsOut),
});

export type RulesInput = SchemaOf<typeof rulesInput>;
export type RulesOutput = SchemaOf<typeof rulesOutput>;

export const mapRulesTask = defineAiTask({
  id: "example-mapping.rules",
  toolId: "example-mapping",
  tier: "full",
  effort: "high",
  maxTokens: 4096,
  input: rulesInput,
  output: rulesOutput,
  fallback: fallbackRules,
  sample: {
    title: "As a shopper, I want to pay with a saved card, so that checkout is quicker",
    notes: "Cards are saved from the account page. Only the card holder can save a card.",
    criteria: "- An expired card is refused\n- The CVC is asked once per session",
    rules: ["An expired card is refused"],
  },
});

/* ── example-mapping.examples ───────────────────────────────────────── */

const KINDS = ["happy", "edge", "broken"] as const;

const exampleOut = z
  .object({
    text: Line(CAP.text).min(1),
    kind: z.enum(KINDS),
    given: Line(CAP.gwt).min(1).optional(),
    when: Line(CAP.gwt).min(1).optional(),
    then: Line(CAP.gwt).min(1).optional(),
  })
  // All three or none: a half-written scenario is dropped, not half kept.
  .refine(
    (e) =>
      [e.given, e.when, e.then].every((v) => v === undefined) ||
      [e.given, e.when, e.then].every((v) => v !== undefined),
    { message: "Given, When and Then: all three or none" }
  );

const examplesInput = z.object({
  title: Line(CAP.text).min(1),
  rule: Line(CAP.text).min(1),
  examples: z.array(Line(CAP.text)).max(CAP.examples),
});

const examplesOutput = z.object({
  examples: z.array(exampleOut).max(CAP.examplesOut),
});

export type ExamplesInput = SchemaOf<typeof examplesInput>;
export type ExamplesOutput = SchemaOf<typeof examplesOutput>;
export type SuggestedExample = ExamplesOutput["examples"][number];

export const mapExamplesTask = defineAiTask({
  id: "example-mapping.examples",
  toolId: "example-mapping",
  tier: "flash",
  effort: "low",
  maxTokens: 4096,
  input: examplesInput,
  output: examplesOutput,
  fallback: fallbackExamples,
  sample: {
    title: "Pay with a saved card",
    rule: "An expired card is refused",
    examples: ["Maria's card expired last month: she is asked for another card"],
  },
});

/* ── example-mapping.questions ──────────────────────────────────────── */

const questionsInput = z.object({
  title: Line(CAP.text).min(1),
  rules: z
    .array(
      z.object({
        id: Line(CAP.id).min(1),
        text: Line(CAP.text).min(1),
        examples: z.array(Line(CAP.text)).max(CAP.examplesPerRule),
      })
    )
    .max(CAP.rules),
  questions: z.array(Line(CAP.text)).max(CAP.questions),
});

const questionsOutput = z.object({
  questions: z
    .array(z.object({ text: Line(CAP.text).min(1), ruleId: Line(CAP.id).min(1).optional() }))
    .max(CAP.questionsOut),
});

export type QuestionsInput = SchemaOf<typeof questionsInput>;
export type QuestionsOutput = SchemaOf<typeof questionsOutput>;

export const mapQuestionsTask = defineAiTask({
  id: "example-mapping.questions",
  toolId: "example-mapping",
  tier: "flash",
  effort: "low",
  maxTokens: 4096,
  input: questionsInput,
  output: questionsOutput,
  fallback: fallbackQuestions,
  sample: {
    title: "Pay with a saved card",
    rules: [
      {
        id: "rule_1",
        text: "An expired card is refused",
        examples: ["Maria's card expired last month: she is asked for another card"],
      },
      { id: "rule_2", text: "Only the card holder can save a card", examples: [] },
    ],
    questions: ["Do we keep cards for business accounts?"],
  },
});
