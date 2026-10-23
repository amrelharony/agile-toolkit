/**
 * SMART checks for a sprint goal and its acceptance criteria. Heuristic:
 * they look for vague words, a quantity and a time reference. Every check
 * matches whole words, so "account" isn't a count, "integrate" isn't a
 * rate, "update" isn't a date and "something" isn't the vague "some".
 * Words count in the sense a goal uses them: "due to" isn't a deadline,
 * "before they pay" isn't one either, and "users can rate stories" isn't
 * a rate. "Relevant" is the user's own tick on a criterion; on the goal
 * itself it means the goal is tied to the business objective or a linked
 * OKR.
 */

import type { Sprint } from "@/lib/stores/workspace-types";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AcceptanceCriterion {
  id: string;
  text: string;
  relevantChecked: boolean;
}

export interface SmartResult {
  specific: boolean;
  measurable: boolean;
  achievable: boolean;
  relevant: boolean;
  timeBound: boolean;
}

export const SMART_KEYS: readonly (keyof SmartResult)[] = [
  "specific",
  "measurable",
  "achievable",
  "relevant",
  "timeBound",
];

export const SMART_LABELS: Record<keyof SmartResult, string> = {
  specific: "Specific",
  measurable: "Measurable",
  achievable: "Achievable",
  relevant: "Relevant",
  timeBound: "Time-bound",
};

/** The checks a result misses, by label, in SMART order. */
export function smartMissing(result: SmartResult): string[] {
  return SMART_KEYS.filter((k) => !result[k]).map((k) => SMART_LABELS[k]);
}

// ─── Word lists ─────────────────────────────────────────────────────────────

/**
 * Words that say nothing checkable, in the forms people write them. A set
 * of whole words rather than stems: the old stem-and-prefix match flagged
 * "something" and "someone" as the vague "some" yet missed "improved" and
 * "optimized", whose stems ("improv", "optimiz") never started with the
 * listed word.
 */
const VAGUE_WORDS = new Set([
  "improve",
  "improves",
  "improved",
  "improving",
  "improvement",
  "improvements",
  "better",
  "good",
  "nice",
  "fine",
  "some",
  "various",
  "stuff",
  "thing",
  "things",
  "enhance",
  "enhances",
  "enhanced",
  "enhancing",
  "enhancement",
  "enhancements",
  "optimize",
  "optimizes",
  "optimized",
  "optimizing",
  "optimization",
  "optimise",
  "optimises",
  "optimised",
  "optimising",
  "optimisation",
  "miscellaneous",
  "etc",
]);

const MONTH =
  "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const COUNT_WORD =
  "(?:\\d+(?:[.,]\\d+)?|an?|one|two|three|four|five|six|seven|eight|nine|ten|twelve)";
const UNIT = "(?:minutes?|mins?|hours?|hrs?|days?|weeks?|months?|sprints?|quarters?)";
const WEEKDAY = "(?:mon|tues|wednes|thurs|fri|satur|sun)day";
/** A year a sprint goal could name; "in 2000 stores" is a count, not a year. */
const YEAR = "20[2-9]\\d";
/** Words that put a bare "25/10" in time: "by 25/10", "due 1/11". */
const DATE_LEAD = "(?:by|on|until|till|before|after|from|since|due)";
/**
 * What makes "before", "until" or "due" a deadline: a point in time after
 * it ("before the release", "until Friday", "due 3 May"), not a clause
 * ("before they pay") or a cause ("due to timeouts").
 */
const TIME_OBJECT = `(?:(?:the |this |next |our )?(?:end|start|close|release|launch|go-live|demo|review|deadline|sprint|iteration|planning|retro(?:spective)?|code freeze|freeze|cut-?off|holidays?|weekend|noon|midnight|today|tonight|tomorrow|${WEEKDAY}|${MONTH})\\b|\\d)`;

/** A quantity in words: rates, totals, limits, small numbers spelled out. */
const QUANTITY_WORDS =
  /\b(?:percent(?:age)?s?|count(?:s|ed)?|totals?|averages?|median|ratios?|rates?|scores?|zero|half|twice|double(?!-)|triple(?!-)|hundreds?|thousands?|millions?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|at least|at most|no more than|no fewer than|fewer than|less than|more than|minimum|maximum|(?:increase|decrease|reduce|cut|grow|drop|raise)[sd]? by)\b/i;

/**
 * Quantity words used in another sense, taken out before QUANTITY_WORDS
 * looks: "no one" isn't a count of one, "users can rate stories" and "we
 * can count on QA" are verbs. "double-click" is handled in the list itself.
 */
const NOT_QUANTITIES: readonly RegExp[] = [
  /\bno one\b/gi,
  /\b(?:can|cannot|to|will|may|must|should|could|would|and|or)\s+(?:rate|score|count)\b/gi,
];

/**
 * Numbers that are a time or a name, not a quantity ("Sprint 14", "Q3",
 * "by 25/10", "3 May", "by 2027", "version 2", "OAuth2"). They're taken out
 * before looking for a number, so a deadline alone doesn't make a goal
 * measurable. Decimals ("2.5 seconds"), fractions ("3/4 of users"), "24/7"
 * and counts ("a cohort of 2000", "Release 2 features") stay: a bare
 * "25/10" is a date only after a word like "by" or with its year.
 */
const TIME_NUMBERS: readonly RegExp[] = [
  /\b(?:sprint|iteration|week|day|q)\s*\d+\b/gi,
  /\bversion\s*\d+(?:\.\d+)*\b/gi,
  /\b(?:in|for|of|by|to|from|until|before|after|with)\s+(?:the\s+)?release\s+\d+(?:\.\d+)*\b/gi,
  // Digits inside a name: "OAuth2", "v2.1", "S3", "B2B".
  /\b[a-z]+\d[a-z\d]*(?:\.\d+)*\b/gi,
  /\b\d{4}-\d{1,2}-\d{1,2}\b/g,
  /\b\d{1,2}\/\d{1,2}\/(?:\d{4}|\d{2})\b/g,
  /\b\d{1,2}\.\d{1,2}\.\d{4}\b/g,
  new RegExp(`\\b${DATE_LEAD}\\s+\\d{1,2}/\\d{1,2}\\b`, "gi"),
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\b(?:,?\\s+\\d{4})?`, "gi"),
  new RegExp(`\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?\\b(?:,?\\s+\\d{4})?`, "gi"),
  new RegExp(`\\b(?:by|in|before|until|during)\\s+${YEAR}\\b`, "gi"),
  /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi,
];

/** A deadline or a point in time. Every alternative is whole words. */
const TIME_PATTERNS: readonly RegExp[] = [
  /\bend of (?:the |this |next )?(?:sprint|iteration|day|week|month|quarter|year)\b/i,
  /\b(?:sprint|iteration) (?:end|review|demo)\b/i,
  /\bdeadlines?\b/i,
  new RegExp(`\\bdue (?:date\\b|by\\b|on\\b|before\\b|at\\b|${TIME_OBJECT})`, "i"),
  new RegExp(`\\b(?:before|until|till) ${TIME_OBJECT}`, "i"),
  new RegExp(`\\b(?:within|in) ${COUNT_WORD} ${UNIT}\\b`, "i"),
  new RegExp(`\\b(?:by|on|until|this|next) ${WEEKDAY}\\b`, "i"),
  /\b(?:today|tonight|tomorrow)\b/i,
  /\b(?:this|next) (?:sprint|iteration|week|month|quarter)\b/i,
  /\b(?:eod|eow|eom|eoq|cob)\b/i,
  /\bby close\b/i,
  /\b(?:sprint|iteration|week|day) \d+\b/i,
  /\bq[1-4]\b/i,
  /\b\d{4}-\d{1,2}-\d{1,2}\b/,
  /\b\d{1,2}\/\d{1,2}\/(?:\d{4}|\d{2})\b/,
  /\b\d{1,2}\.\d{1,2}\.\d{4}\b/,
  new RegExp(`\\b${DATE_LEAD} \\d{1,2}/\\d{1,2}\\b`, "i"),
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\b`, "i"),
  new RegExp(`\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`, "i"),
  new RegExp(`\\b(?:by|in|until|before|end of) ${MONTH}\\b`, "i"),
  new RegExp(`\\b(?:by|in|before|until|during) ${YEAR}\\b`, "i"),
];

// ─── Checks ─────────────────────────────────────────────────────────────────

/**
 * Lower-case whole words. "don't" stays whole, and so does a hyphenated
 * compound: "fine-grained" isn't the vague "fine".
 */
function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[a-z]+(?:['-][a-z]+)*/g) ?? [];
}

export function hasVagueWord(text: string): boolean {
  return wordsOf(text).some((w) => VAGUE_WORDS.has(w));
}

export function isMeasurable(text: string): boolean {
  if (text.includes("%")) return true;
  const words = NOT_QUANTITIES.reduce((t, re) => t.replace(re, " "), text);
  if (QUANTITY_WORDS.test(words)) return true;
  const withoutTimes = TIME_NUMBERS.reduce((t, re) => t.replace(re, " "), text);
  return /\d/.test(withoutTimes);
}

export function isTimeBound(text: string): boolean {
  return TIME_PATTERNS.some((re) => re.test(text));
}

/** The SMART checks on one sentence, with "Relevant" decided by the caller. */
export function smartCheck(rawText: string, relevant: boolean): SmartResult {
  const text = rawText.trim();
  return {
    specific: text.length > 10 && !hasVagueWord(text),
    measurable: isMeasurable(text),
    achievable: text.length >= 20 && text.length <= 300,
    relevant,
    timeBound: isTimeBound(text),
  };
}

/** SMART checks for an acceptance criterion; "Relevant" is the user's tick. */
export function validateSmart(criterion: AcceptanceCriterion): SmartResult {
  return smartCheck(criterion.text, criterion.relevantChecked);
}

/**
 * SMART checks for the goal sentence itself. It's relevant when it serves
 * the business objective or a linked OKR, and time-bound by its sprint
 * (a sprint goal ends with the sprint) or a time in the sentence.
 */
export function goalSmart(
  goal: { goal: string; businessObjective: string; okrIds?: readonly string[] },
  sprint?: Pick<Sprint, "id">
): SmartResult {
  const result = smartCheck(
    goal.goal,
    Boolean(goal.businessObjective.trim()) || (goal.okrIds?.length ?? 0) > 0
  );
  return { ...result, timeBound: result.timeBound || Boolean(sprint) };
}
