import type { PromptDefinition } from "./types";
import { buildPreamble, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import type { ExampleMap } from "../stores/workspace-types";
import { QUESTION_STATUS_LABEL, examplesOf, mapCounts } from "../example-mapping/model";

/**
 * Copyable prompts for the example map open on the page: a challenge of its
 * rules, and the examples it is still missing. Everything typed is user
 * content, so the map is wrapped as data. No map, no prompts.
 */
export function generateExampleMappingPrompts(map: ExampleMap | null): PromptDefinition[] {
  if (!map) return [];
  const c = mapCounts(map);
  const rules = map.rules.map((r, i) => {
    const examples = examplesOf(map, r.id).map((e) => `   - ${sanitizePromptCell(e.text, 200)}`);
    return [`${i + 1}. ${sanitizePromptCell(r.text, 200)}`, ...examples].join("\n");
  });
  const questions = map.questions.map(
    (q) => `- [${QUESTION_STATUS_LABEL[q.status].toLowerCase()}] ${sanitizePromptCell(q.text, 200)}`
  );
  const block = [
    `Story: ${sanitizePromptCell(map.title, 200)}`,
    rules.length > 0 ? `Rules, each with its examples:\n${rules.join("\n")}` : "Rules: none yet",
    questions.length > 0 ? `Questions:\n${questions.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const context = `Example map with ${c.rules} rules, ${c.examples} examples and ${c.open} open questions.`;
  const data = `## The example map\n\n${wrapUserContent(block)}\n\n`;
  return [
    {
      id: "challenge-rules",
      title: "Challenge these rules",
      description: "Find rules that overlap, contradict each other or hide two rules in one.",
      prompt:
        buildPreamble("Example Mapping tool", context) +
        data +
        "## Questions\n\n1. Which rules overlap, or contradict each other?\n2. Which rule is really two rules, and how would you word each?\n3. Which rule is missing, given the story?\n4. If the team could build only one rule first, which one gives the most value, and why?",
    },
    {
      id: "missing-examples",
      title: "Find the missing examples",
      description: "Concrete examples the map doesn't have yet, written as Given, When, Then.",
      prompt:
        buildPreamble("Example Mapping tool", context) +
        data +
        "## Questions\n\n1. For each rule, suggest one example at its limit and one where it stops someone, with real names and numbers.\n2. Write each as Given, When, Then.\n3. Which example would make the team ask a question it hasn't asked yet?",
    },
  ];
}
