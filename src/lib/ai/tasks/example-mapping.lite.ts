/**
 * Example Mapping's AI tasks, the lite half pages import (no zod; the defs,
 * with their schemas, are `example-mapping.ts` and load on first AI use):
 * the caps the page sizes its inputs to, the three fallbacks, and one ref
 * per task.
 */

import { lazyAiTask } from "../task-ref";
import { draftScenarios } from "@/lib/backlog/health";
import type {
  ExamplesInput,
  ExamplesOutput,
  QuestionsInput,
  QuestionsOutput,
  RulesInput,
  RulesOutput,
  SuggestedExample,
} from "./example-mapping";
export type {
  ExamplesInput,
  ExamplesOutput,
  QuestionsInput,
  QuestionsOutput,
  RulesInput,
  RulesOutput,
  SuggestedExample,
} from "./example-mapping";

/** The caps both halves share. */
export const EXAMPLE_MAPPING_AI = {
  /** A card's text, in and out. */
  text: 200,
  /** A story's notes or criteria sent with the rules task. */
  notes: 2000,
  /** Rules the map can hold (TOOL_LIST_MAX.mapRules). */
  rules: 12,
  /** Examples one rule can hold (the model's EXAMPLES_PER_RULE_MAX). */
  examples: 10,
  /** Examples per rule sent with the questions task. */
  examplesPerRule: 5,
  /** Questions the map can hold (TOOL_LIST_MAX.mapQuestions). */
  questions: 20,
  /** A Given, When or Then the AI writes. */
  gwt: 300,
  /** An id, as the page mints them. */
  id: 64,
  /** Suggestions one ask returns. */
  rulesOut: 6,
  questionsOut: 5,
  examplesOut: 4,
} as const;

const cap = (t: string, max: number) => (t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t);
const line = (t: string, max: number = EXAMPLE_MAPPING_AI.text) =>
  cap(t.replace(/\s+/g, " ").trim(), max);
/** Compared as the same card: case, spacing, list markers and a closing stop aside. */
const key = (t: string) =>
  t
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/, "")
    .toLowerCase();
/** "“Pay with a saved card”" for a template, cut to fit. */
const quoted = (t: string, max = 120) => `“${line(t, max).replace(/[.?!]+$/, "")}”`;

/** A fallback's input must be what the schema takes: never answer for a blank story. */
function needTitle(title: string): void {
  if (!title.trim()) throw new Error("Name the story first.");
}

/* ── example-mapping.rules ──────────────────────────────────────────── */

/** Words that make a sentence read as a rule. */
const RULE_WORDS =
  /\b(must|must not|only|never|always|at most|at least|no more than|before|after|cannot|can't|may not|unless|until|within|requires?|limit(?:ed)?)\b/i;

/** A list item: "- x", "* x", "• x", "1. x". */
const LIST_ITEM = /^\s*(?:[-*•]|\d+[.)])\s+/;

/** Three questions any story's map should ask, in our words. */
export const TEMPLATE_QUESTIONS = [
  "Who may do this, and who may not?",
  "What is the smallest version of this that would still be useful?",
  "What should happen if it fails half way through?",
] as const;

/**
 * Rules without AI: each line of the acceptance criteria, list items in the
 * notes, and any sentence of the title or notes with a rule word in it
 * (must, only, never, at most, before…), list markers stripped, each once
 * and none the map already has. Then the three template questions.
 */
export function fallbackRules(input: RulesInput): RulesOutput {
  needTitle(input.title);
  const have = new Set(input.rules.map(key));
  const out: { text: string }[] = [];
  const add = (raw: string) => {
    const text = line(raw.replace(LIST_ITEM, ""));
    const k = key(text);
    if (!k || have.has(k) || out.length >= EXAMPLE_MAPPING_AI.rulesOut) return;
    have.add(k);
    out.push({ text });
  };
  for (const l of input.criteria.split(/\r?\n/)) add(l);
  const notes = input.notes.split(/\r?\n/);
  for (const l of notes) if (LIST_ITEM.test(l)) add(l);
  const sentences = [
    input.title,
    ...notes
      .filter((l) => !LIST_ITEM.test(l))
      .join(" ")
      .split(/(?<=[.!?])\s+/),
  ];
  for (const s of sentences) if (RULE_WORDS.test(s)) add(s);
  return { rules: out, questions: TEMPLATE_QUESTIONS.map((text) => ({ text })) };
}

export const rulesTask = lazyAiTask<RulesInput, RulesOutput>(
  { id: "example-mapping.rules", toolId: "example-mapping", fallback: fallbackRules },
  () => import("./example-mapping").then((m) => m.rulesTask)
);

/* ── example-mapping.examples ───────────────────────────────────────── */

/**
 * Examples for one rule without AI: the usual case (the first starting
 * scenario Backlog Health drafts from the title), the rule not met (a
 * failure row of our own), and a case right at the rule's limit, as a line
 * to fill in. One the rule already has, by its words, is left out.
 */
export function fallbackExamples(input: ExamplesInput): ExamplesOutput {
  needTitle(input.title);
  if (!input.rule.trim()) throw new Error("Pick a rule first.");
  const have = new Set(input.examples.map(key));
  const r = quoted(input.rule);
  const happy = draftScenarios(input.title)[0];
  const candidates: SuggestedExample[] = [
    {
      text: line(`The usual case: ${happy.when}, and ${happy.then}`),
      kind: "happy",
      given: line(happy.given, EXAMPLE_MAPPING_AI.gwt),
      when: line(happy.when, EXAMPLE_MAPPING_AI.gwt),
      then: line(happy.then, EXAMPLE_MAPPING_AI.gwt),
    },
    {
      text: line(`The rule ${r} isn't met, and someone tries anyway`),
      kind: "broken",
      given: line(`the rule ${r} isn't met`, EXAMPLE_MAPPING_AI.gwt),
      when: "someone tries anyway",
      then: "they are stopped and told why",
    },
    { text: line(`Right at the limit of ${r}`), kind: "edge" },
  ];
  return {
    examples: candidates
      .filter((c) => !have.has(key(c.text)))
      .slice(0, EXAMPLE_MAPPING_AI.examplesOut),
  };
}

export const examplesTask = lazyAiTask<ExamplesInput, ExamplesOutput>(
  { id: "example-mapping.examples", toolId: "example-mapping", fallback: fallbackExamples },
  () => import("./example-mapping").then((m) => m.examplesTask)
);

/* ── example-mapping.questions ──────────────────────────────────────── */

/**
 * Questions without AI, from the map's shape: a rule with no example asks
 * for one, a rule with more than four may be two, the first rule's edge,
 * and which rule matters most when there are several. One the map already
 * asks, by its words, is left out.
 */
export function fallbackQuestions(input: QuestionsInput): QuestionsOutput {
  needTitle(input.title);
  const have = new Set(input.questions.map(key));
  const out: QuestionsOutput["questions"] = [];
  const add = (text: string, ruleId?: string) => {
    const t = line(text);
    if (have.has(key(t)) || out.length >= EXAMPLE_MAPPING_AI.questionsOut) return;
    have.add(key(t));
    out.push(ruleId ? { text: t, ruleId } : { text: t });
  };
  for (const r of input.rules) {
    if (r.examples.length === 0) add(`What is one real example of ${quoted(r.text, 80)}?`, r.id);
    else if (r.examples.length > 4) add(`Is ${quoted(r.text, 80)} really two rules?`, r.id);
  }
  const first = input.rules[0];
  if (first) add(`What happens right at the edge of ${quoted(first.text, 80)}?`, first.id);
  if (input.rules.length > 1) add("If we could build only one of these rules first, which one?");
  if (input.rules.length === 0) add(`What must ${quoted(input.title, 80)} always do, or never do?`);
  add("Who should we ask about the cases nobody here knows?");
  return { questions: out };
}

/** The questions with any rule id the map doesn't have taken off. */
export function keepKnownRules(
  output: QuestionsOutput,
  input: Pick<QuestionsInput, "rules">
): QuestionsOutput {
  const ids = new Set(input.rules.map((r) => r.id));
  return {
    questions: output.questions.map((q) => (q.ruleId && !ids.has(q.ruleId) ? { text: q.text } : q)),
  };
}

export const questionsTask = lazyAiTask<QuestionsInput, QuestionsOutput>(
  { id: "example-mapping.questions", toolId: "example-mapping", fallback: fallbackQuestions },
  () => import("./example-mapping").then((m) => m.questionsTask)
);
