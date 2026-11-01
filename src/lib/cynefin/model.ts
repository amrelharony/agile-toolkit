/**
 * Cynefin sense-making: the five domains, what each asks a team to do, the
 * guided questions that suggest one, and the keyword classifier agents
 * use when they only have signals.
 *
 * The questions only SUGGEST a domain (senseDomain); the team confirms it,
 * so an item is never filed by a default. A complex item is one to probe,
 * so it can become a hypothesis to test (the "hypothesis" hand-off), and
 * hypothesisStateOf says whether that test has started or finished.
 *
 * Pure and server-safe: the Cynefin page and the tool.cynefin agent
 * actions share every recipe, question, suggestion and verdict here, so an
 * item classified by either reads the same in both.
 */

import type {
  CynefinAnswer,
  CynefinDomain,
  CynefinItem,
  CynefinQuestionId,
  HandoffLink,
  HandoffRef,
  Hypothesis,
} from "@/lib/stores/workspace-types";
import { CYNEFIN_ANSWERS, CYNEFIN_QUESTION_IDS } from "@/lib/stores/workspace-types";
import type { HandoffSource } from "@/lib/handoffs/types";

export { CYNEFIN_ANSWERS, CYNEFIN_QUESTION_IDS };

export const TITLE_MAX = 200;
export const RATIONALE_MAX = 2000;
export const ACTION_MAX = 2000;

/** The five domains in the order the page lists them. */
export const DOMAIN_IDS = [
  "clear",
  "complicated",
  "complex",
  "chaotic",
  "confused",
] as const satisfies readonly CynefinDomain[];

export interface DomainSpec {
  id: CynefinDomain;
  label: string;
  /** What the team does in this domain (the default plan for an item). */
  recipe: string;
  /** One line on what the domain is, for the picker. */
  meaning: string;
}

export const DOMAINS: Readonly<Record<CynefinDomain, DomainSpec>> = {
  clear: {
    id: "clear",
    label: "Clear",
    recipe: "Sense → Categorise → Respond. Apply best practice.",
    meaning: "The answer is known: apply the best practice.",
  },
  complicated: {
    id: "complicated",
    label: "Complicated",
    recipe: "Sense → Analyse → Respond. Bring in experts.",
    meaning: "Experts can work the answer out by analysis.",
  },
  complex: {
    id: "complex",
    label: "Complex",
    recipe: "Probe → Sense → Respond. Run safe-to-fail experiments.",
    meaning: "Only trying will tell: run safe-to-fail experiments.",
  },
  chaotic: {
    id: "chaotic",
    label: "Chaotic",
    recipe: "Act → Sense → Respond. Stabilise first, then learn.",
    meaning: "Something is going wrong now: act to stabilise first.",
  },
  confused: {
    id: "confused",
    label: "Confused",
    recipe: "Break the problem into smaller domain-tagged pieces.",
    meaning: "It isn't clear which domain it is: break it into parts.",
  },
};

export function isDomain(v: unknown): v is CynefinDomain {
  return (DOMAIN_IDS as readonly unknown[]).includes(v);
}

/**
 * A stored domain as one of the five: the pre-2014 "simple" (now Clear)
 * and anything else unknown read as Confused, so the item still shows.
 */
export function normalizeDomain(raw: unknown): CynefinDomain {
  return isDomain(raw) ? raw : "confused";
}

/** The plan an item shows: one written for it, or its domain's recipe. */
export function planOf(item: Pick<CynefinItem, "domain" | "recommendedAction">): {
  text: string;
  custom: boolean;
} {
  const recipe = DOMAINS[normalizeDomain(item.domain)].recipe;
  const own = item.recommendedAction?.trim();
  // A copy of any domain's recipe (written when the item was filed) isn't a custom plan.
  const isRecipe = own ? DOMAIN_IDS.some((d) => DOMAINS[d].recipe === own) : true;
  return own && !isRecipe ? { text: own, custom: true } : { text: recipe, custom: false };
}

/* ── Guided questions ────────────────────────────────────────────────── */

export interface CynefinQuestion {
  id: CynefinQuestionId;
  text: string;
}

export const QUESTIONS: readonly CynefinQuestion[] = [
  {
    id: "crisis",
    text: "Is something going wrong right now that needs action before analysis?",
  },
  {
    id: "known",
    text: "Would anyone experienced agree on the answer: is there a known best practice?",
  },
  { id: "analysable", text: "Can experts work out the answer by analysis before acting?" },
  { id: "emergent", text: "Will you only learn what works by trying something and watching?" },
  { id: "disagree", text: "Does the team disagree on which of these it is?" },
];

export const ANSWER_LABEL: Readonly<Record<CynefinAnswer, string>> = {
  yes: "Yes",
  no: "No",
  unsure: "Not sure",
};

export type CynefinAnswers = Partial<Record<CynefinQuestionId, CynefinAnswer>>;

/** The stored answers: known questions with known answers only. */
export function normalizeAnswers(raw: unknown): CynefinAnswers {
  if (!raw || typeof raw !== "object") return {};
  const out: CynefinAnswers = {};
  for (const q of CYNEFIN_QUESTION_IDS) {
    const a = (raw as Record<string, unknown>)[q];
    if ((CYNEFIN_ANSWERS as readonly unknown[]).includes(a)) out[q] = a as CynefinAnswer;
  }
  return out;
}

export interface DomainSuggestion {
  /** The domain the answers point to; null when they don't point to one yet. */
  domain: CynefinDomain | null;
  /** Why, in a sentence (also the rationale prefilled when the suggestion is used). */
  reason: string;
  /** How many questions have an answer (Not sure counts as answered). */
  answered: number;
}

/**
 * The domain the answers suggest, and why. In order:
 *   - something is going wrong now → Chaotic (on its own: act first);
 *   - the team disagrees, or the answers contradict each other (a known
 *     best practice that only trying will reveal) → Confused;
 *   - a known best practice → Clear;
 *   - only trying will tell → Complex;
 *   - experts can analyse it → Complicated;
 *   - no known answer and analysis won't find one → Complex.
 * Fewer than two answers, or answers that point nowhere, suggest nothing:
 * the team picks, or answers more.
 */
export function senseDomain(raw: unknown): DomainSuggestion {
  const a = normalizeAnswers(raw);
  const answered = Object.keys(a).length;
  const at = (domain: CynefinDomain, reason: string): DomainSuggestion => ({
    domain,
    reason,
    answered,
  });
  if (a.crisis === "yes") {
    return at(
      "chaotic",
      "Something is going wrong right now: act to stabilise it first, then make sense of it."
    );
  }
  if (answered < 2) {
    return {
      domain: null,
      reason: "Answer at least two questions for a suggestion.",
      answered,
    };
  }
  if (a.disagree === "yes") {
    return at(
      "confused",
      "The team disagrees on what kind of problem this is: break it into parts and place each one."
    );
  }
  if (a.known === "yes" && a.emergent === "yes") {
    return at(
      "confused",
      "A known best practice and “only trying will tell” don't fit together: split the problem and place each part."
    );
  }
  if (a.known === "yes") {
    return at(
      "clear",
      "Anyone experienced would agree on the answer: apply the known best practice."
    );
  }
  if (a.emergent === "yes") {
    return at(
      "complex",
      "You'll only learn what works by trying something and watching: run safe-to-fail experiments."
    );
  }
  if (a.analysable === "yes") {
    return at("complicated", "Experts can work out the answer by analysis before acting.");
  }
  if (a.known === "no" && a.analysable === "no") {
    return at(
      "complex",
      "There's no known answer and analysis won't find one: probe with safe-to-fail experiments."
    );
  }
  return {
    domain: null,
    reason: "These answers don't point to one domain yet: answer the others, or pick one.",
    answered,
  };
}

/* ── Keyword classifier (agents) ─────────────────────────────────────── */

export interface SignalClassification {
  recommendedDomain: CynefinDomain;
  rationale: string;
  recommendedAction: string;
  /** Whether any signal was recognised (no signal reads as Confused). */
  matched: boolean;
}

const SIGNALS: readonly { domain: CynefinDomain; words: readonly string[] }[] = [
  {
    domain: "chaotic",
    words: ["urgent", "chaos", "crisis", "act now", "emergency", "fire"],
  },
  {
    domain: "complex",
    words: ["unknown-unknowns", "unknown unknowns", "emergent", "experiment", "probe"],
  },
  {
    domain: "complicated",
    words: ["known-unknowns", "known unknowns", "expert", "analyse", "analyze"],
  },
  {
    domain: "clear",
    words: ["known-knowns", "known knowns", "best practice", "obvious", "routine"],
  },
  { domain: "confused", words: ["undecided", "unclear", "no agreement", "confused"] },
];

const SIGNAL_REASON: Readonly<Record<CynefinDomain, string>> = {
  chaotic: "urgency / crisis signal — stabilise before classifying further",
  complex: "unknown-unknowns / emergent signal — needs probing not planning",
  complicated: "known-unknowns signal — analysable with the right expertise",
  clear: "known-knowns / best-practice signal — apply established recipe",
  confused: "explicit confused signal — break into smaller domain-tagged pieces",
};

/**
 * A domain from signal keywords (case-insensitive; a signal matches the
 * first domain whose words it contains, checked chaotic first). When
 * several domains match: chaotic, then complex, complicated, clear, and
 * confused last, which is also the answer when nothing matches.
 */
export function classifySignals(signals: readonly string[]): SignalClassification {
  const seen = new Set<CynefinDomain>();
  const matched: string[] = [];
  for (const raw of signals) {
    const s = raw.toLowerCase().trim();
    if (!s) continue;
    const hit = SIGNALS.find((g) => g.words.some((w) => s.includes(w)));
    if (!hit) continue;
    seen.add(hit.domain);
    matched.push(s);
  }
  const domain = SIGNALS.map((g) => g.domain).find((d) => seen.has(d)) ?? "confused";
  const reason =
    seen.size === 0
      ? "no recognised signals — gather more information before classifying"
      : SIGNAL_REASON[domain];
  const list = matched.length > 0 ? ` (matched: ${matched.join(", ")})` : "";
  return {
    recommendedDomain: domain,
    rationale: `${reason}${list}`,
    recommendedAction: DOMAINS[domain].recipe,
    matched: seen.size > 0,
  };
}

/* ── Complex items as hypotheses ─────────────────────────────────────── */

/** Where a complex item's experiment stands: not sent, being tested, or tested. */
export type HypothesisState = "none" | "testing" | "tested";

/** The item's link to a hypothesis, if it was sent to one. */
export function hypothesisLinkOf(item: Pick<CynefinItem, "sentTo">): HandoffLink | undefined {
  return (item.sentTo ?? []).find((l) => l.route === "hypothesis");
}

/**
 * Whether the hypothesis an item was sent to is still there and has a
 * result (validated, invalidated or inconclusive), from the Hypothesis
 * Tracker's list. A link whose hypothesis is gone reads as not sent.
 */
export function hypothesisStateOf(
  item: Pick<CynefinItem, "sentTo">,
  hypotheses: readonly Pick<Hypothesis, "id" | "status">[] | undefined
): HypothesisState {
  const link = hypothesisLinkOf(item);
  if (!link) return "none";
  const h = (hypotheses ?? []).find((x) => x.id === link.targetId);
  if (!h) return "none";
  return h.status === "validated" || h.status === "invalidated" || h.status === "inconclusive"
    ? "tested"
    : "testing";
}

/**
 * A complex item's title as its hypothesis's "We believe" line, as the
 * other hand-offs send theirs. The Hypothesis Tracker labels that field
 * "We believe" itself, so a title that starts with the words loses them
 * ("We believe that X" reads "that X", the tracker's own placeholder);
 * a title that is only the words stays as typed.
 */
export function hypothesisTitle(title: string): string {
  const t = title.trim();
  return t.replace(/^we believe\b[\s,:]*/i, "") || t;
}

/** What a complex item hands to the Hypothesis Tracker. */
export function hypothesisSourceOf(item: CynefinItem): HandoffSource {
  const sourceRef: HandoffRef = { tool: "cynefin", id: item.id };
  const why = item.rationale?.trim();
  return {
    title: hypothesisTitle(item.title),
    ...(why ? { description: why } : {}),
    sourceRef,
  };
}

/** `links` with `link` recorded, replacing an older link on its route (as the hand-off registry does). */
export function withSentLink(
  links: readonly HandoffLink[] | undefined,
  link: HandoffLink
): HandoffLink[] {
  return [...(links ?? []).filter((l) => l.route !== link.route), link];
}

/* ── The verdict ─────────────────────────────────────────────────────── */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Items grouped by domain (an unknown domain reads as Confused), in the page's order. */
export function groupByDomain<T extends Pick<CynefinItem, "domain">>(
  items: readonly T[]
): Record<CynefinDomain, T[]> {
  const out = Object.fromEntries(DOMAIN_IDS.map((d) => [d, [] as T[]])) as Record<
    CynefinDomain,
    T[]
  >;
  for (const it of items) out[normalizeDomain(it.domain)].push(it);
  return out;
}

/** The complex items no hypothesis is testing yet (never sent, or its hypothesis is gone). */
export function complexNotTested<T extends CynefinItem>(
  items: readonly T[],
  hypotheses: readonly Pick<Hypothesis, "id" | "status">[] | undefined
): T[] {
  return items.filter(
    (it) => normalizeDomain(it.domain) === "complex" && hypothesisStateOf(it, hypotheses) === "none"
  );
}

/**
 * Where the complex items' tests stand once every one has a hypothesis:
 * "all being tested", "all tested" (each has a result), or both counted.
 */
function testsText(complex: number, tested: number): string {
  if (tested === 0) return complex === 1 ? "being tested" : "all being tested";
  if (tested === complex) return complex === 1 ? "tested" : "all tested";
  return `${tested} tested, ${complex - tested} being tested`;
}

/**
 * The board in one sentence: "7 items: 3 complex (2 not yet tested as
 * hypotheses), 1 chaotic: stabilise it first." A hypothesis with a result
 * (validated, invalidated or inconclusive) counts as tested, not as being
 * tested.
 */
export function cynefinVerdict(
  items: readonly CynefinItem[],
  hypotheses: readonly Pick<Hypothesis, "id" | "status">[] | undefined
): string {
  if (items.length === 0) return "No problems placed yet.";
  const g = groupByDomain(items);
  const parts: string[] = [];
  const complex = g.complex.length;
  if (complex > 0) {
    const untested = complexNotTested(g.complex, hypotheses).length;
    const tested = g.complex.filter((it) => hypothesisStateOf(it, hypotheses) === "tested").length;
    parts.push(
      untested === 0
        ? `${complex} complex${tested > 0 && tested < complex ? ":" : ","} ${testsText(complex, tested)}`
        : untested === complex
          ? `${complex} complex, ${complex === 1 ? "not" : "none"} yet tested as ${complex === 1 ? "a hypothesis" : "hypotheses"}`
          : `${complex} complex (${untested} not yet tested as ${untested === 1 ? "a hypothesis" : "hypotheses"})`
    );
  }
  for (const d of ["complicated", "clear", "confused"] as const) {
    if (g[d].length > 0) parts.push(`${g[d].length} ${d}`);
  }
  const chaotic = g.chaotic.length;
  if (chaotic > 0) {
    parts.push(`${chaotic} chaotic: stabilise ${chaotic === 1 ? "it" : "them"} first`);
  }
  return `${plural(items.length, "item")}: ${parts.join(", ")}.`;
}
