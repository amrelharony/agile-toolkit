/**
 * The Kano model on the page: what each feature's answers say (its
 * category, how many answers, Better and Worse), which list it goes in and
 * what the exports read. Every class, count, category and coefficient is
 * the method registry's (lib/prioritization/methods/kano), the code the
 * agent actions use, so the page and an agent read a feature the same way.
 * Pure.
 *
 * The category is derived, never picked: from survey counts (the most
 * common class, once there are 3 answers), else from one person's answer
 * pair. A category picked by hand on the old page still counts, marked
 * "Picked by hand" with a prompt to add answers; an unknown one is "Not
 * answered", never Performance.
 */

import type { PrioritizationItem } from "@/lib/stores/workspace-types";
import { KANO, type Values } from "@/lib/prioritization/methods";
import {
  KANO_ANSWER_LABEL,
  KANO_CATEGORIES,
  KANO_CATEGORY_LABEL,
  KANO_CATEGORY_MEANING,
  KANO_CLASSES,
  KANO_CLASS_CATEGORY,
  KANO_COUNT_KEYS,
  KANO_MIN_RESPONSES,
  kanoClass,
  kanoCoefficients,
  readKano,
  type KanoCategory,
  type KanoClass,
  type KanoCounts,
  type KanoReading,
} from "@/lib/prioritization/methods/kano";
import { formatNumber, toNumber } from "@/lib/prioritization/methods/fields";
import { rankMethodRows, type RankedRow } from "@/lib/prioritization/rank";

export const FRAMEWORK = "kano" as const;

/** Counts that haven't reached 3 answers yet. */
export const NEEDS_MORE = "needs-more" as const;
/** Nothing answered (or a stored category the page can't read). */
export const UNANSWERED = "unanswered" as const;

export type KanoGroupId = KanoCategory | typeof NEEDS_MORE | typeof UNANSWERED;

/** A name short enough for a sentence or a toast. */
export function shortName(name: string, max = 40): string {
  const t = name.trim() || "Untitled feature";
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** The features, read and scored by the registry. */
export function kanoRows(rows: readonly PrioritizationItem[]): RankedRow[] {
  return rankMethodRows(FRAMEWORK, rows);
}

/** What a feature's answers say. */
export interface FeatureView {
  ranked: RankedRow;
  reading: KanoReading;
  /** The derived (or legacy picked) category; null until there's enough. */
  category: KanoCategory | null;
  /** One person's answer pair's class, for the "1 answer pair" line. */
  pairClass: KanoClass | null;
  /** Better and Worse, only from KANO_MIN_RESPONSES counted answers. */
  coefficients: { better: number; worse: number; n: number } | null;
  /** Answers counted (the counts' total, 1 for a pair, 0 otherwise). */
  n: number;
  picked: boolean;
  group: KanoGroupId;
}

export function featureView(r: RankedRow): FeatureView {
  const reading = readKano(r.values);
  const category = (r.result.bucket as KanoCategory | null) ?? null;
  const enough = reading.counts !== null && reading.n >= KANO_MIN_RESPONSES;
  const coefficients = enough && reading.counts ? kanoCoefficients(reading.counts) : null;
  const pairClass = reading.pair
    ? kanoClass(reading.pair.functional, reading.pair.dysfunctional)
    : null;
  const group: KanoGroupId = category
    ? category
    : reading.counts && reading.n > 0
      ? NEEDS_MORE
      : UNANSWERED;
  return {
    ranked: r,
    reading,
    category,
    pairClass: reading.counts ? null : pairClass,
    coefficients,
    n: reading.n,
    picked: reading.source === "picked",
    group,
  };
}

/** List order: what customers expect first (Decide order's ranking), then the rest. */
export const GROUP_ORDER: readonly KanoGroupId[] = [...KANO_CATEGORIES, NEEDS_MORE, UNANSWERED];

export const GROUP_LABEL: Record<KanoGroupId, string> = {
  ...KANO_CATEGORY_LABEL,
  [NEEDS_MORE]: "Needs more answers",
  [UNANSWERED]: "Not answered",
};

export const GROUP_MEANING: Record<KanoGroupId, string> = {
  ...KANO_CATEGORY_MEANING,
  [NEEDS_MORE]: `Survey counts under ${KANO_MIN_RESPONSES} answers: the category shows from ${KANO_MIN_RESPONSES}.`,
  [UNANSWERED]: "Answer both questions, enter survey counts, or ask customers in a round.",
};

/**
 * Within a list: expected features by how much missing them hurts (Worse),
 * delighters by how much having them helps (Better), the rest by answers
 * counted; then by title. Features without coefficients come after those
 * with.
 */
export function compareFeatures(a: RankedRow, b: RankedRow): number {
  const fa = featureView(a);
  const fb = featureView(b);
  const ga = GROUP_ORDER.indexOf(fa.group);
  const gb = GROUP_ORDER.indexOf(fb.group);
  if (ga !== gb) return ga - gb;
  const key = (f: FeatureView): number | null => {
    if (!f.coefficients) return null;
    if (f.group === "attractive") return f.coefficients.better;
    if (f.group === "must-be" || f.group === "performance") return -f.coefficients.worse;
    return f.n;
  };
  const ka = key(fa);
  const kb = key(fb);
  if (ka !== kb) {
    if (ka === null) return 1;
    if (kb === null) return -1;
    return kb - ka;
  }
  return a.row.title.localeCompare(b.row.title);
}

export interface KanoGroup {
  id: KanoGroupId;
  label: string;
  meaning: string;
  features: FeatureView[];
}

/** The lists in GROUP_ORDER, features in the order given (the order on screen while editing). */
export function kanoGroups(rows: readonly RankedRow[]): KanoGroup[] {
  const groups = GROUP_ORDER.map((id) => ({
    id,
    label: GROUP_LABEL[id],
    meaning: GROUP_MEANING[id],
    features: [] as FeatureView[],
  }));
  const byId = new Map(groups.map((g) => [g.id, g]));
  for (const r of rows) {
    const f = featureView(r);
    byId.get(f.group)?.features.push(f);
  }
  return groups;
}

/** "0.71", or "—" when there's no coefficient yet. */
export const coefText = (n: number | null | undefined): string =>
  n === null || n === undefined ? "—" : formatNumber(n, 2);

/** How a feature was answered, in words: "12 answers", "1 answer pair: I like it / I dislike it", "Picked by hand". */
export function answersText(f: FeatureView): string {
  if (f.reading.counts) return f.n === 1 ? "1 answer" : `${f.n} answers`;
  if (f.reading.pair) {
    return `1 answer pair: ${KANO_ANSWER_LABEL[f.reading.pair.functional]} / ${KANO_ANSWER_LABEL[f.reading.pair.dysfunctional]}`;
  }
  if (f.picked) return "Picked by hand";
  return "Not answered";
}

/** Survey counts from a draft (whole numbers, blanks as 0); null when none are typed. */
export function draftCounts(v: Values): KanoCounts | null {
  if (!KANO_CLASSES.some((k) => toNumber(v[KANO_COUNT_KEYS[k]]) !== undefined)) return null;
  const out = {} as KanoCounts;
  for (const k of KANO_CLASSES) {
    out[k] = Math.max(0, Math.floor(toNumber(v[KANO_COUNT_KEYS[k]]) ?? 0));
  }
  return out;
}

/**
 * The form's live line: the class of one answer pair ("I like it if it
 * has it, I dislike it if it doesn't: Performance (O)."), or what survey
 * counts add up to, and what's missing.
 */
export function previewText(v: Values, mode: "pair" | "counts"): string {
  if (mode === "counts") {
    const c = draftCounts(v);
    const total = c ? KANO_CLASSES.reduce((n, k) => n + c[k], 0) : 0;
    if (!c || total === 0) return "Enter how many answer pairs came out in each class.";
    if (total < KANO_MIN_RESPONSES) {
      return `${total} ${total === 1 ? "answer" : "answers"} so far: the category shows from ${KANO_MIN_RESPONSES}.`;
    }
    const r = KANO.evaluate(v);
    const cat = r.bucket as KanoCategory | null;
    const coef = kanoCoefficients(c);
    const tail = coef ? ` Better ${coefText(coef.better)}, Worse ${coefText(coef.worse)}.` : "";
    return cat
      ? `${total} answers: ${KANO_CATEGORY_LABEL[cat]}.${tail}`
      : `${total} answers.${tail}`;
  }
  const r = readKano(v);
  if (!r.pair) return "Answer both questions to see the category.";
  const cls = kanoClass(r.pair.functional, r.pair.dysfunctional);
  return `“${KANO_ANSWER_LABEL[r.pair.functional]}” if it has it, “${KANO_ANSWER_LABEL[r.pair.dysfunctional]}” if it doesn't: ${KANO_CATEGORY_LABEL[KANO_CLASS_CATEGORY[cls]]} (${cls}).`;
}

/** The CSV export: the category derived, never a stored one. */
export function toCsv(rows: readonly RankedRow[]): {
  headers: string[];
  rows: (string | number)[][];
} {
  return {
    headers: ["Feature", "Category", "How answered", "Answers", ...KANO_CLASSES, "Better", "Worse"],
    rows: rows.map((r) => {
      const f = featureView(r);
      const c = f.reading.counts;
      return [
        r.row.title,
        f.category ? KANO_CATEGORY_LABEL[f.category] : GROUP_LABEL[f.group],
        answersText(f),
        f.n,
        ...KANO_CLASSES.map((k) => (c ? c[k] : "")),
        f.coefficients ? coefText(f.coefficients.better) : "",
        f.coefficients ? coefText(f.coefficients.worse) : "",
      ];
    }),
  };
}

/** The features as the AI prompt reads them: grouped by derived category. */
export function promptGroups(rows: readonly RankedRow[]): Record<string, PrioritizationItem[]> {
  const out: Record<string, PrioritizationItem[]> = {};
  for (const g of kanoGroups(rows)) {
    if (g.features.length > 0) out[g.label] = g.features.map((f) => f.ranked.row);
  }
  return out;
}
