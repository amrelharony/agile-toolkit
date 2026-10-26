/**
 * Kano: which features customers expect, which delight them, and which
 * they don't care about, derived from the paired question
 * ("If it has this, how do you feel?" / "If it doesn't, how do you feel?")
 * through the Kano evaluation table (Berger et al. 1993; Sauerwein et al.
 * 1996). The category is always derived, never picked.
 *
 * A row holds one of:
 * - survey counts: how many answer pairs fell in each class A/O/M/I/R/Q,
 *   plus n (`kanoA`…`kanoQ`, `kanoN`, with `kanoSource`, `kanoRoundId`,
 *   `kanoAt`; from a live round, a facilitator's tally or typed in). The
 *   category is the most common class (ties M > O > A > I > R > Q) and
 *   the Better/Worse coefficients follow; both need 3 answers.
 * - one answer pair (`functional`, `dysfunctional`): its class.
 * - legacy: a category picked by hand (`category`), read as "Picked by
 *   hand" and never written; the old Sat/Dissat scores
 *   (`satIfPresent`, `dissatIfAbsent`) are left untouched and unused.
 * Precedence: counts, then the pair, then the picked category.
 *
 * Decide order ranks must-be > performance > attractive > indifferent >
 * reverse > questionable: cover what customers expect before delighters.
 */

import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { formatNumber, notScored, put, toChoice, toNumber, toValidation } from "./fields";
import type { BucketDef, MethodInput, PrioritizationMethod, RowFields, Values } from "./types";
import type { FormErrors } from "@/lib/utils/form";

/** The answer scale, in the order of the evaluation table's rows and columns. */
export const KANO_ANSWERS = ["like", "must", "neutral", "live_with", "dislike"] as const;
export type KanoAnswer = (typeof KANO_ANSWERS)[number];

export const KANO_ANSWER_LABEL: Record<KanoAnswer, string> = {
  like: "I like it",
  must: "I expect it",
  neutral: "I'm neutral",
  live_with: "I can live with it",
  dislike: "I dislike it",
};

/** The two questions of the pair. */
export const KANO_QUESTIONS = {
  functional: "If it has this, how do you feel?",
  dysfunctional: "If it doesn't have this, how do you feel?",
} as const;

/** The evaluation table's classes: Attractive, One-dimensional (performance), Must-be, Indifferent, Reverse, Questionable. */
export const KANO_CLASSES = ["A", "O", "M", "I", "R", "Q"] as const;
export type KanoClass = (typeof KANO_CLASSES)[number];
export type KanoCounts = Record<KanoClass, number>;

export const KANO_CATEGORIES = [
  "must-be",
  "performance",
  "attractive",
  "indifferent",
  "reverse",
  "questionable",
] as const;
export type KanoCategory = (typeof KANO_CATEGORIES)[number];

export const KANO_CLASS_CATEGORY: Record<KanoClass, KanoCategory> = {
  A: "attractive",
  O: "performance",
  M: "must-be",
  I: "indifferent",
  R: "reverse",
  Q: "questionable",
};

export const KANO_CATEGORY_LABEL: Record<KanoCategory, string> = {
  "must-be": "Must-be",
  performance: "Performance",
  attractive: "Attractive",
  indifferent: "Indifferent",
  reverse: "Reverse",
  questionable: "Questionable",
};

export const KANO_CATEGORY_MEANING: Record<KanoCategory, string> = {
  "must-be": "Expected: missing it causes strong dissatisfaction; having it is taken for granted.",
  performance: "The more and better it is, the happier customers are.",
  attractive: "A delighter: having it creates outsized satisfaction; missing it isn't missed.",
  indifferent: "Customers don't care either way.",
  reverse: "Having it makes some customers less satisfied.",
  questionable: "The answers contradict each other: check the question.",
};

/**
 * The Kano evaluation table: rows are the answer to "if it has this",
 * columns the answer to "if it doesn't".
 *
 *              like  must  neutral  live_with  dislike
 *   like        Q     A      A         A          O
 *   must        R     I      I         I          M
 *   neutral     R     I      I         I          M
 *   live_with   R     I      I         I          M
 *   dislike     R     R      R         R          Q
 */
export const KANO_TABLE: Record<KanoAnswer, Record<KanoAnswer, KanoClass>> = {
  like: { like: "Q", must: "A", neutral: "A", live_with: "A", dislike: "O" },
  must: { like: "R", must: "I", neutral: "I", live_with: "I", dislike: "M" },
  neutral: { like: "R", must: "I", neutral: "I", live_with: "I", dislike: "M" },
  live_with: { like: "R", must: "I", neutral: "I", live_with: "I", dislike: "M" },
  dislike: { like: "R", must: "R", neutral: "R", live_with: "R", dislike: "Q" },
};

/** Decide order's ranking of the categories: the method's score. */
export const KANO_RANK: Record<KanoCategory, number> = {
  "must-be": 5,
  performance: 4,
  attractive: 3,
  indifferent: 2,
  reverse: 1,
  questionable: 0,
};

/** The category and the coefficients show from this many answers. */
export const KANO_MIN_RESPONSES = MIN_SAMPLE.anonymous;

/** How a tie for the most common class is broken. */
const TIE_ORDER: readonly KanoClass[] = ["M", "O", "A", "I", "R", "Q"];

/** Where a row's answers came from. */
export const KANO_SOURCES = ["pair", "counts", "room", "tally"] as const;
export type KanoSource = (typeof KANO_SOURCES)[number];

/** The class of one answer pair. */
export function kanoClass(functional: KanoAnswer, dysfunctional: KanoAnswer): KanoClass {
  return KANO_TABLE[functional][dysfunctional];
}

export const EMPTY_KANO_COUNTS: KanoCounts = { A: 0, O: 0, M: 0, I: 0, R: 0, Q: 0 };

export const countTotal = (c: KanoCounts): number => KANO_CLASSES.reduce((n, k) => n + c[k], 0);

/** Two sets of counts added ("Add to earlier answers"). */
export function addCounts(a: KanoCounts, b: KanoCounts): KanoCounts {
  const out = { ...EMPTY_KANO_COUNTS };
  for (const k of KANO_CLASSES) out[k] = a[k] + b[k];
  return out;
}

/**
 * The class counts of a 5×5 joint count of answer pairs (index
 * functional × 5 + dysfunctional, in KANO_ANSWERS order), as a vote round
 * folds them; null for a joint of the wrong size or with a bad cell.
 */
export function countsFromJoint(joint: readonly number[]): KanoCounts | null {
  const P = KANO_ANSWERS.length;
  if (joint.length !== P * P) return null;
  const out = { ...EMPTY_KANO_COUNTS };
  for (let f = 0; f < P; f++) {
    for (let d = 0; d < P; d++) {
      const n = joint[f * P + d];
      if (!Number.isInteger(n) || n < 0) return null;
      out[kanoClass(KANO_ANSWERS[f], KANO_ANSWERS[d])] += n;
    }
  }
  return out;
}

/** The most common class's category (ties M > O > A > I > R > Q); null when there are no answers. */
export function kanoCategory(c: KanoCounts): KanoCategory | null {
  let best: KanoClass | null = null;
  for (const k of TIE_ORDER) if (c[k] > 0 && (best === null || c[k] > c[best])) best = k;
  return best ? KANO_CLASS_CATEGORY[best] : null;
}

/**
 * Better = (A + O) ÷ n and Worse = −(O + M) ÷ n, over the answers that say
 * something (n = A + O + M + I; Reverse and Questionable are left out).
 * Null when none do.
 */
export function kanoCoefficients(
  c: KanoCounts
): { better: number; worse: number; n: number } | null {
  const n = c.A + c.O + c.M + c.I;
  if (n === 0) return null;
  return { better: (c.A + c.O) / n, worse: -(c.O + c.M) / n, n };
}

const COUNT_KEY: Record<KanoClass, string> = {
  A: "kanoA",
  O: "kanoO",
  M: "kanoM",
  I: "kanoI",
  R: "kanoR",
  Q: "kanoQ",
};

/** The old hand-picked categories (and the one the table adds). */
const PICKED = KANO_CATEGORIES;

/** What a row's Kano fields say. */
export interface KanoReading {
  source: KanoSource | "picked" | null;
  counts: KanoCounts | null;
  pair: { functional: KanoAnswer; dysfunctional: KanoAnswer } | null;
  /** A legacy category picked by hand. */
  picked: KanoCategory | null;
  /** Answers counted: the counts' total (or n when it's larger), 1 for a pair, 0 otherwise. */
  n: number;
}

/** A row's Kano fields (or a draft), read: counts first, then a pair, then a picked category. */
export function readKano(fields: Values | undefined): KanoReading {
  const functional = toChoice(KANO_ANSWERS, fields?.functional);
  const dysfunctional = toChoice(KANO_ANSWERS, fields?.dysfunctional);
  const pair = functional && dysfunctional ? { functional, dysfunctional } : null;
  const hasCounts = KANO_CLASSES.some((k) => toNumber(fields?.[COUNT_KEY[k]]) !== undefined);
  const counts = hasCounts ? { ...EMPTY_KANO_COUNTS } : null;
  if (counts) {
    for (const k of KANO_CLASSES) {
      const n = toNumber(fields?.[COUNT_KEY[k]]);
      counts[k] = n !== undefined && n > 0 ? Math.floor(n) : 0;
    }
  }
  const picked = toChoice(PICKED, fields?.category) ?? null;
  const storedSource = toChoice(KANO_SOURCES, fields?.kanoSource);
  if (counts) {
    const total = countTotal(counts);
    const n = Math.max(total, Math.floor(toNumber(fields?.kanoN) ?? 0));
    return { source: storedSource ?? "counts", counts, pair, picked, n: total === 0 ? 0 : n };
  }
  if (pair) return { source: "pair", counts: null, pair, picked, n: 1 };
  if (picked) return { source: "picked", counts: null, pair: null, picked, n: 0 };
  return { source: null, counts: null, pair: null, picked: null, n: 0 };
}

const INPUTS: readonly MethodInput[] = [
  {
    key: "functional",
    kind: "choice",
    label: KANO_QUESTIONS.functional,
    hint: "The answer if the feature is there.",
    missing: "Answer both questions.",
    options: KANO_ANSWERS.map((id) => ({ id, label: KANO_ANSWER_LABEL[id] })),
    optional: true,
  },
  {
    key: "dysfunctional",
    kind: "choice",
    label: KANO_QUESTIONS.dysfunctional,
    hint: "The answer if the feature is missing.",
    missing: "Answer both questions.",
    options: KANO_ANSWERS.map((id) => ({ id, label: KANO_ANSWER_LABEL[id] })),
    optional: true,
  },
  ...KANO_CLASSES.map(
    (k): MethodInput => ({
      key: COUNT_KEY[k],
      kind: "number",
      label: `${KANO_CATEGORY_LABEL[KANO_CLASS_CATEGORY[k]]} (${k})`,
      hint: `Answer pairs that came out ${k}.`,
      missing: "Enter a whole number, 0 or more.",
      min: 0,
      step: 1,
      optional: true,
    })
  ),
];

/** The row's own count keys. */
export const KANO_COUNT_KEYS: Record<KanoClass, string> = COUNT_KEY;

function read(fields: Values | undefined): Values {
  const r = readKano(fields);
  const out: Values = {
    functional: toChoice(KANO_ANSWERS, fields?.functional),
    dysfunctional: toChoice(KANO_ANSWERS, fields?.dysfunctional),
    category: r.picked ?? undefined,
    kanoN: r.counts ? r.n : undefined,
    kanoSource: r.counts ? (r.source ?? undefined) : undefined,
    kanoRoundId: typeof fields?.kanoRoundId === "string" ? fields.kanoRoundId : undefined,
    kanoAt: typeof fields?.kanoAt === "string" ? fields.kanoAt : undefined,
  };
  for (const k of KANO_CLASSES) out[COUNT_KEY[k]] = r.counts ? r.counts[k] : undefined;
  return out;
}

function write(fields: RowFields | undefined, v: Values): RowFields {
  const out: RowFields = { ...fields };
  put(out, "functional", toChoice(KANO_ANSWERS, v.functional));
  put(out, "dysfunctional", toChoice(KANO_ANSWERS, v.dysfunctional));
  const hasCounts = KANO_CLASSES.some((k) => toNumber(v[COUNT_KEY[k]]) !== undefined);
  let total = 0;
  for (const k of KANO_CLASSES) {
    const n = toNumber(v[COUNT_KEY[k]]);
    const kept = hasCounts ? Math.max(0, Math.floor(n ?? 0)) : undefined;
    total += kept ?? 0;
    put(out, COUNT_KEY[k], kept);
  }
  put(out, "kanoN", hasCounts ? Math.max(total, Math.floor(toNumber(v.kanoN) ?? 0)) : undefined);
  put(
    out,
    "kanoSource",
    hasCounts ? (toChoice(KANO_SOURCES, v.kanoSource) ?? "counts") : undefined
  );
  put(
    out,
    "kanoRoundId",
    hasCounts && typeof v.kanoRoundId === "string" ? v.kanoRoundId : undefined
  );
  put(out, "kanoAt", hasCounts && typeof v.kanoAt === "string" ? v.kanoAt : undefined);
  // Answers replace a hand-picked category; the page never writes one.
  if (
    hasCounts ||
    (toChoice(KANO_ANSWERS, v.functional) && toChoice(KANO_ANSWERS, v.dysfunctional))
  ) {
    delete out.category;
  }
  return out;
}

/** Fields for a round's counts on a row ("room" or "tally"), replacing earlier counts. */
export function kanoCountFields(
  fields: RowFields | undefined,
  counts: KanoCounts,
  meta: { source: KanoSource; roundId?: string; at?: string }
): RowFields {
  const v: Values = { kanoSource: meta.source, kanoRoundId: meta.roundId, kanoAt: meta.at };
  for (const k of KANO_CLASSES) v[COUNT_KEY[k]] = counts[k];
  const out = write(fields, { ...KANO.read(fields), ...v, kanoN: countTotal(counts) });
  if (!meta.roundId) delete out.kanoRoundId;
  if (!meta.at) delete out.kanoAt;
  return out;
}

const BUCKETS: readonly BucketDef[] = KANO_CATEGORIES.map((id, order) => ({
  id,
  label: KANO_CATEGORY_LABEL[id],
  meaning: KANO_CATEGORY_MEANING[id],
  order,
  tone:
    id === "must-be"
      ? "danger"
      : id === "performance"
        ? "accent"
        : id === "attractive"
          ? "success"
          : id === "reverse"
            ? "warning"
            : "muted",
}));

export const KANO: PrioritizationMethod = {
  id: "kano",
  toolId: "kano-model",
  label: "Kano",
  embedded: false,
  inputs: INPUTS,
  buckets: BUCKETS,
  read,
  write,
  validate(draft) {
    const errors: FormErrors<string> = {};
    const functional = toChoice(KANO_ANSWERS, draft.functional);
    const dysfunctional = toChoice(KANO_ANSWERS, draft.dysfunctional);
    const countValues = KANO_CLASSES.map((k) => draft[COUNT_KEY[k]]);
    const anyCount = countValues.some((n) => n !== undefined && String(n).trim() !== "");
    for (const k of KANO_CLASSES) {
      const raw = draft[COUNT_KEY[k]];
      if (raw === undefined || String(raw).trim() === "") continue;
      const n = toNumber(raw);
      if (n === undefined || n < 0 || !Number.isInteger(n))
        errors[COUNT_KEY[k]] = INPUTS[2].missing;
    }
    if (anyCount) {
      const total = countValues.reduce<number>((s, n) => s + Math.max(0, toNumber(n) ?? 0), 0);
      if (total === 0 && Object.keys(errors).length === 0) {
        errors[COUNT_KEY.A] = "Enter at least one answer.";
      }
    } else if (!functional && !dysfunctional) {
      errors.functional = "Answer both questions, or enter the survey counts.";
    } else if (!functional) {
      errors.functional = "Answer both questions.";
    } else if (!dysfunctional) {
      errors.dysfunctional = "Answer both questions.";
    }
    return toValidation(draft, errors);
  },
  evaluate(v) {
    const r = readKano(v);
    if (r.counts) {
      const category = kanoCategory(r.counts);
      const coefficients = kanoCoefficients(r.counts);
      const extra = {
        source: r.source,
        n: r.n,
        A: r.counts.A,
        O: r.counts.O,
        M: r.counts.M,
        I: r.counts.I,
        R: r.counts.R,
        Q: r.counts.Q,
      };
      // Results wait for KANO_MIN_RESPONSES answers: fewer is noise.
      if (r.n < KANO_MIN_RESPONSES || !category) {
        return { ...notScored(["answers"]), extra: { ...extra, needed: KANO_MIN_RESPONSES } };
      }
      return {
        score: KANO_RANK[category],
        bucket: category,
        sortKey: KANO_RANK[category],
        missing: [],
        warnings: [],
        extra: {
          ...extra,
          better: coefficients?.better ?? null,
          worse: coefficients?.worse ?? null,
        },
      };
    }
    if (r.pair) {
      const cls = kanoClass(r.pair.functional, r.pair.dysfunctional);
      const category = KANO_CLASS_CATEGORY[cls];
      return {
        score: KANO_RANK[category],
        bucket: category,
        sortKey: KANO_RANK[category],
        missing: [],
        warnings: [],
        extra: { source: "pair", class: cls, n: 1 },
      };
    }
    if (r.picked) {
      return {
        score: KANO_RANK[r.picked],
        bucket: r.picked,
        sortKey: KANO_RANK[r.picked],
        missing: [],
        warnings: ["Picked by hand: add answers to derive the category."],
        extra: { source: "picked", n: 0 },
      };
    }
    return notScored(["functional", "dysfunctional"]);
  },
  format: (score) => formatNumber(score, 2),
};

/** A row's Kano category, or null (not answered, or too few answers). */
export function kanoCategoryOf(fields: Values | undefined): KanoCategory | null {
  return (KANO.evaluate(read(fields)).bucket as KanoCategory | null) ?? null;
}
