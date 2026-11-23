// @vitest-environment node
/**
 * Golden tests for Example Mapping's AI tasks: the prompt the server
 * builds, a typical model answer read into the output, a bad answer
 * salvaged (a half-written scenario dropped), the fallbacks without a
 * model for a user-story title and a plain one, and the largest input
 * fitting the body budget in 3-byte text.
 */

import { describe, expect, it } from "vitest";
import { parseAnswer } from "@/lib/ai/parse-answer";
import { buildTaskSystem, buildTaskUser } from "@/lib/ai/run-task.server";
import { TOOL_AI_BODY_BUDGET } from "@/lib/ai/contract";
import { jsonBytes } from "@/lib/utils/json-bytes";
import {
  EXAMPLE_MAPPING_AI as CAP,
  TEMPLATE_QUESTIONS,
  mapExamplesTask,
  fallbackExamples,
  fallbackQuestions,
  fallbackRules,
  keepKnownRules,
  mapQuestionsTask,
  mapRulesTask,
} from "@/lib/ai/tasks/example-mapping";
import {
  mapExamplesPrompt,
  mapQuestionsPrompt,
  mapRulesPrompt,
} from "@/lib/ai/tasks/example-mapping.server";

/** 3-byte text: the most a counted character of real text costs. */
const wide = (n: number) => "語".repeat(n);

describe("example-mapping.rules", () => {
  it("is a reasoning task the owner and visitors can use", () => {
    expect(mapRulesTask).toMatchObject({
      toolId: "example-mapping",
      tier: "full",
      maxTokens: 4096,
    });
    expect(mapRulesTask.ownerOnly).toBeUndefined();
  });

  it("sends the story and the rules so far as data", () => {
    expect(buildTaskSystem(mapRulesTask, mapRulesPrompt)).toContain("Example Mapping");
    const user = buildTaskUser(mapRulesPrompt, mapRulesTask.input.parse(mapRulesTask.sample));
    expect(user).toContain("Story: As a shopper, I want to pay with a saved card");
    expect(user).toContain("- An expired card is refused");
  });

  it("reads a typical answer, keeping six of too many", () => {
    const rules = Array.from({ length: 8 }, (_, i) => ({ text: `Rule ${i}` }));
    const parsed = parseAnswer(
      JSON.stringify({ rules, questions: [{ text: "Who?" }] }),
      mapRulesTask.output
    );
    expect(parsed.ok && parsed.data.rules).toHaveLength(6);
  });

  it("falls back to the criteria lines and rule sentences, none twice, plus template questions", () => {
    const out = fallbackRules(mapRulesTask.input.parse(mapRulesTask.sample));
    const texts = out.rules.map((r) => r.text);
    expect(texts).not.toContain("An expired card is refused");
    expect(texts).toContain("The CVC is asked once per session");
    expect(texts).toContain("Only the card holder can save a card.");
    expect(out.questions.map((q) => q.text)).toEqual([...TEMPLATE_QUESTIONS]);
    expect(mapRulesTask.output.safeParse(out).success).toBe(true);
  });

  it("refuses a blank story rather than answer for one", () => {
    expect(() => fallbackRules({ title: " ", notes: "", criteria: "", rules: [] })).toThrow();
  });
});

describe("example-mapping.examples", () => {
  it("sends the story and the rule as data", () => {
    const user = buildTaskUser(
      mapExamplesPrompt,
      mapExamplesTask.input.parse(mapExamplesTask.sample)
    );
    expect(user).toContain("Rule: An expired card is refused");
    expect(buildTaskSystem(mapExamplesTask, mapExamplesPrompt)).toContain('"happy"');
  });

  it("drops a half-written scenario and keeps the rest", () => {
    const parsed = parseAnswer(
      JSON.stringify({
        examples: [
          { text: "Full", kind: "happy", given: "a", when: "b", then: "c" },
          { text: "Half", kind: "edge", given: "a", when: "b" },
          { text: "Line", kind: "broken" },
          { text: "Bad kind", kind: "weird" },
        ],
      }),
      mapExamplesTask.output
    );
    expect(parsed.ok && parsed.data.examples.map((e) => e.text)).toEqual(["Full", "Line"]);
  });

  it("falls back to a usual case, a failure and a limit case, for a user story and a plain title", () => {
    const story = fallbackExamples({
      title: "As a shopper, I want to pay with a saved card, so that checkout is quicker",
      rule: "An expired card is refused",
      examples: [],
    });
    expect(story.examples.map((e) => e.kind)).toEqual(["happy", "broken", "edge"]);
    expect(story.examples[0].given).toBe("I am a shopper");
    expect(story.examples[1]).toMatchObject({
      when: "someone tries anyway",
      then: "they are stopped and told why",
    });
    expect(story.examples[2].given).toBeUndefined();
    expect(mapExamplesTask.output.safeParse(story).success).toBe(true);
    const plain = fallbackExamples({ title: "Saved cards", rule: "Only holders", examples: [] });
    expect(plain.examples[0].when).toContain("“Saved cards”");
    expect(mapExamplesTask.output.safeParse(plain).success).toBe(true);
  });
});

describe("example-mapping.questions", () => {
  it("lists rules by id with their examples", () => {
    const user = buildTaskUser(
      mapQuestionsPrompt,
      mapQuestionsTask.input.parse(mapQuestionsTask.sample)
    );
    expect(user).toContain("rule_1 | An expired card is refused");
    expect(user).toContain("  - Maria's card expired last month");
  });

  it("falls back to questions from the map's shape, and keeps only known rule ids", () => {
    const out = fallbackQuestions(mapQuestionsTask.input.parse(mapQuestionsTask.sample));
    expect(out.questions[0]).toMatchObject({ ruleId: "rule_2" });
    expect(out.questions[0].text).toContain("“Only the card holder can save a card”");
    expect(mapQuestionsTask.output.safeParse(out).success).toBe(true);
    const kept = keepKnownRules(
      {
        questions: [
          { text: "A", ruleId: "rule_1" },
          { text: "B", ruleId: "invented" },
        ],
      },
      mapQuestionsTask.sample
    );
    expect(kept.questions).toEqual([{ text: "A", ruleId: "rule_1" }, { text: "B" }]);
  });

  it("fits the body budget at every cap, in 3-byte text", () => {
    const input = {
      title: wide(CAP.text),
      rules: Array.from({ length: CAP.rules }, (_, i) => ({
        id: wide(CAP.id - 3) + String(i).padStart(3, "0"),
        text: wide(CAP.text),
        examples: Array.from({ length: CAP.examplesPerRule }, () => wide(CAP.text)),
      })),
      questions: Array.from({ length: CAP.questions }, () => wide(CAP.text)),
    };
    expect(mapQuestionsTask.input.safeParse(input).success).toBe(true);
    expect(jsonBytes({ task: mapQuestionsTask.id, input })).toBeLessThanOrEqual(
      TOOL_AI_BODY_BUDGET
    );
    const rules = {
      title: wide(CAP.text),
      notes: wide(CAP.notes),
      criteria: wide(CAP.notes),
      rules: Array.from({ length: CAP.rules }, () => wide(CAP.text)),
    };
    expect(mapRulesTask.input.safeParse(rules).success).toBe(true);
    expect(jsonBytes({ task: mapRulesTask.id, input: rules })).toBeLessThanOrEqual(
      TOOL_AI_BODY_BUDGET
    );
  });
});
