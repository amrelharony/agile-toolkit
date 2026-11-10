/**
 * The story check: six questions to ask of any story (INVEST), and five
 * ways to split one that is too big. Plain text and a count, with no AI and
 * no key: the same help a story generator gives, from questions a team can
 * answer aloud in a minute. Pure.
 */

import { listAnd } from "@/lib/charts/chart-text";

export type InvestId =
  | "independent"
  | "negotiable"
  | "valuable"
  | "estimable"
  | "small"
  | "testable";

export interface InvestQuestion {
  id: InvestId;
  /** The word the letter stands for. */
  word: string;
  /** Asked so that "yes" is the good answer. */
  question: string;
}

export const INVEST_QUESTIONS: readonly InvestQuestion[] = [
  {
    id: "independent",
    word: "Independent",
    question: "Can it be built and released without waiting for another story?",
  },
  {
    id: "negotiable",
    word: "Negotiable",
    question: "Does it say what is needed, and leave how to build it open?",
  },
  {
    id: "valuable",
    word: "Valuable",
    question: "Would a user or the business notice when it is done?",
  },
  {
    id: "estimable",
    word: "Estimable",
    question: "Does the team know enough to size it?",
  },
  {
    id: "small",
    word: "Small",
    question: "Does it fit in one sprint, with room to spare?",
  },
  {
    id: "testable",
    word: "Testable",
    question: "Is it clear how to check that it works?",
  },
];

export interface SplitPattern {
  id: "spike" | "path" | "interface" | "data" | "rules";
  name: string;
  how: string;
}

/** Ways to cut a story that is too big into ones that still deliver something. */
export const SPLIT_PATTERNS: readonly SplitPattern[] = [
  {
    id: "spike",
    name: "Spike",
    how: "Too many unknowns? Do a short, timeboxed piece of research first, then size what is left.",
  },
  {
    id: "path",
    name: "Path",
    how: "Build the main path through it first. Errors, rare cases and other routes become stories of their own.",
  },
  {
    id: "interface",
    name: "Interface",
    how: "Start with the plainest screen, or with one device or one way in. The rest follow.",
  },
  {
    id: "data",
    name: "Data",
    how: "Handle one kind of data first, such as one currency or one file type, then add the others.",
  },
  {
    id: "rules",
    name: "Rules",
    how: "Ship the basic rule first. Each extra business rule or limit is its own story.",
  },
];

export interface InvestResult {
  /** How many of the six are answered yes. */
  yes: number;
  /** The questions not answered yes, in order. */
  open: InvestQuestion[];
  /** "Small" isn't a yes while the check is under way: point at the splits. */
  tooBig: boolean;
  /** One sentence for under the questions. */
  text: string;
}

/**
 * Where a story stands on the six questions. `answeredYes` holds the ids
 * ticked; an id that isn't one of the six is ignored.
 */
export function investResult(answeredYes: readonly string[]): InvestResult {
  const ticked = new Set(answeredYes);
  const open = INVEST_QUESTIONS.filter((q) => !ticked.has(q.id));
  const total = INVEST_QUESTIONS.length;
  const yes = total - open.length;
  const tooBig = yes > 0 && open.some((q) => q.id === "small");
  const text =
    yes === 0
      ? "Tick each question the answer is yes to."
      : yes === total
        ? "Yes to all six: the story holds up."
        : `Yes to ${yes} of ${total}. Still open: ${listAnd(open.map((q) => q.word))}.${
            tooBig ? " If it is too big for a sprint, try one of the splits below." : ""
          }`;
  return { yes, open, tooBig, text };
}
