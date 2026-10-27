/**
 * NPS and CSAT as one reading for the NPS / CSAT page, its Markdown and the
 * tool.nps_csat agent actions. Before Phase 8 the page and the agent
 * computed the numbers apart (the agent's NPS read 0 with no responses, its
 * CSAT average rounded differently), the trend plotted one point per
 * answer day, and CSAT was a mean of 1–5 instead of the share satisfied.
 *
 * - NPS: promoters 9–10, passives 7–8, detractors 0–6; the score is
 *   round((promoters − detractors) / n × 100), null with no responses
 *   (0 is a real score).
 * - CSAT: % satisfied, the share scoring 4 or 5 of 1–5; 3 is neutral and
 *   1–2 dissatisfied. The mean stays as a secondary number.
 * - Periods: calendar weeks ("2026-W42", ISO, Monday to Sunday) or months
 *   ("2026-10") from lib/analytics/periods, consecutive with the empty ones
 *   kept, each with its n and whether it meets MIN_SAMPLE.surveyPeriod.
 *
 * Rows saved before Phase 8 may hold a fraction (the page clamped, never
 * rounded) or a blank date. A fraction on the scale counts by the same
 * thresholds (7.5 is a passive); a score off the kind's scale is left out
 * and counted (`offScale`); a row with no readable day counts in every
 * total but no period (`undated`).
 *
 * Pure; server-safe (the MCP route calls it).
 */

import { NPS_TAG_LIMIT, NPS_TAG_MAX_LENGTH, type NpsResponse } from "@/lib/stores/workspace-types";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import {
  comparePeriods,
  periodBounds,
  periodLabel,
  periodOf,
  periodRange,
  MAX_PERIODS,
} from "@/lib/analytics/periods";
import { isExampleId } from "@/lib/utils/example-id";

export type SurveyKind = NpsResponse["kind"];

export type NpsCategory = "promoter" | "passive" | "detractor";

export type CsatCategory = "satisfied" | "neutral" | "dissatisfied";

/** The lowest and highest score of each kind's scale. */
export const SCORE_RANGE: Record<SurveyKind, { min: number; max: number }> = {
  nps: { min: 0, max: 10 },
  csat: { min: 1, max: 5 },
};

/** A CSAT score at or above this counts as satisfied. */
export const CSAT_SATISFIED_MIN = 4;

/** Promoter 9–10, passive 7–8, detractor below 7 (a legacy 7.5 is a passive). */
export function npsCategory(score: number): NpsCategory {
  if (score >= 9) return "promoter";
  return score >= 7 ? "passive" : "detractor";
}

/** Satisfied 4–5, neutral 3, dissatisfied below 3. */
export function csatCategory(score: number): CsatCategory {
  if (score >= CSAT_SATISFIED_MIN) return "satisfied";
  return score >= 3 ? "neutral" : "dissatisfied";
}

/**
 * Whether a write may store `score` for `kind`: a whole number on its scale
 * (NPS 0–10, CSAT 1–5). The page's form, its import and the agent's record
 * all judge by this; the workspace CRUD judges by the same bound.
 */
export function isValidScore(kind: SurveyKind, score: number): boolean {
  const range = SCORE_RANGE[kind];
  return Number.isInteger(score) && score >= range.min && score <= range.max;
}

/**
 * Whether a stored score counts: a finite number on its kind's scale. A
 * fraction counts (rows from before Phase 8); a value off the scale (an
 * agent's NPS of 11) doesn't.
 */
export function isReadableScore(kind: SurveyKind, score: unknown): score is number {
  const range = SCORE_RANGE[kind];
  return (
    typeof score === "number" && Number.isFinite(score) && score >= range.min && score <= range.max
  );
}

const readable = (r: NpsResponse) =>
  (r.kind === "nps" || r.kind === "csat") && isReadableScore(r.kind, r.score);

/** Responses that aren't from the example (`example-` ids): the team's own. */
export function realResponses(rs: readonly NpsResponse[]): NpsResponse[] {
  return rs.filter((r) => !isExampleId(r.id));
}

export interface NpsSummary {
  /** NPS responses counted. */
  n: number;
  /** −100..100, or null with no responses. */
  score: number | null;
  promoters: number;
  passives: number;
  detractors: number;
}

export interface CsatSummary {
  /** CSAT responses counted. */
  n: number;
  /** Scoring 4 or 5. */
  satisfied: number;
  /** round(satisfied / n × 100), or null with no responses. */
  satisfiedPct: number | null;
  /** The mean score to one decimal (1–5), or null with no responses. */
  average: number | null;
}

/** The NPS of every readable NPS response in `rs` (other kinds are ignored). */
export function summarizeNps(rs: readonly NpsResponse[]): NpsSummary {
  let promoters = 0;
  let passives = 0;
  let detractors = 0;
  for (const r of rs) {
    if (r.kind !== "nps" || !readable(r)) continue;
    const c = npsCategory(r.score);
    if (c === "promoter") promoters += 1;
    else if (c === "passive") passives += 1;
    else detractors += 1;
  }
  const n = promoters + passives + detractors;
  return {
    n,
    score: n === 0 ? null : Math.round(((promoters - detractors) / n) * 100),
    promoters,
    passives,
    detractors,
  };
}

/** CSAT as % satisfied for every readable CSAT response in `rs` (other kinds are ignored). */
export function summarizeCsat(rs: readonly NpsResponse[]): CsatSummary {
  let n = 0;
  let satisfied = 0;
  let sum = 0;
  for (const r of rs) {
    if (r.kind !== "csat" || !readable(r)) continue;
    n += 1;
    sum += r.score;
    if (csatCategory(r.score) === "satisfied") satisfied += 1;
  }
  return {
    n,
    satisfied,
    satisfiedPct: n === 0 ? null : Math.round((satisfied / n) * 100),
    average: n === 0 ? null : Math.round((sum / n) * 10) / 10,
  };
}

/** Whether `n` responses in one period are enough to read without a warning. */
export function enoughForPeriod(n: number): boolean {
  return n >= MIN_SAMPLE.surveyPeriod;
}

/**
 * How many points one answer moves a score read from `n` responses:
 * round(100 / n), quoted in the small-sample warning ("Only 6 NPS
 * responses: one answer moves NPS by 17 points"). Null with none.
 */
export function answerSwing(n: number): number | null {
  return n > 0 ? Math.round(100 / n) : null;
}

/* ── Tags ───────────────────────────────────────────────────────────── */

/** Split on commas, trimmed, inner spaces collapsed, lower-cased; blanks dropped. */
function splitTags(raw: string | readonly string[]): string[] {
  const parts = typeof raw === "string" ? [raw] : raw;
  return parts
    .flatMap((p) => (typeof p === "string" ? p.split(",") : []))
    .map((t) => t.trim().replace(/\s+/g, " ").toLowerCase())
    .filter((t) => t.length > 0);
}

/**
 * Theme tags as stored: split on commas, trimmed, lower-case, each once,
 * at most NPS_TAG_LIMIT, each cut to NPS_TAG_MAX_LENGTH. A form or agent
 * write checks tagsProblem first, so nothing typed is cut silently; the
 * cut keeps a reader of an odd stored row within the schema.
 */
export function normalizeTags(raw: string | readonly string[]): string[] {
  const out: string[] = [];
  for (const t of splitTags(raw)) {
    const tag = t.slice(0, NPS_TAG_MAX_LENGTH).trim();
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length === NPS_TAG_LIMIT) break;
  }
  return out;
}

/** The longest respondent saved (a name or an email): the page's form and import, record and the CRUD. */
export const RESPONDENT_MAX = 120;
/** The longest verbatim saved, for the same writers. */
export const VERBATIM_MAX = 4000;

/**
 * Why `raw` can't be saved as a response's tags as typed, or null when it
 * can: more than NPS_TAG_LIMIT different tags, or one longer than
 * NPS_TAG_MAX_LENGTH characters.
 */
export function tagsProblem(raw: string | readonly string[]): string | null {
  const tags = Array.from(new Set(splitTags(raw)));
  const long = tags.find((t) => t.length > NPS_TAG_MAX_LENGTH);
  if (long !== undefined) {
    return `“${long.slice(0, 20)}…” is longer than ${NPS_TAG_MAX_LENGTH} characters.`;
  }
  if (tags.length > NPS_TAG_LIMIT) {
    return `At most ${NPS_TAG_LIMIT} tags on a response (${tags.length} given).`;
  }
  return null;
}

/** Whether response `r` carries `tag` (compared as normalizeTags writes them). */
export function hasTag(r: Pick<NpsResponse, "tags">, tag: string): boolean {
  const want = normalizeTags(tag)[0];
  return want !== undefined && normalizeTags(r.tags ?? []).includes(want);
}

export interface TagCount {
  tag: string;
  /** Responses with the tag (readable scores only). */
  n: number;
  promoters: number;
  detractors: number;
  satisfied: number;
  dissatisfied: number;
  /** Detractors plus dissatisfied: the Next step's "unhappy responses". */
  unhappy: number;
  /** The NPS and CSAT of the tag's responses (show them from MIN_SAMPLE.surveyPeriod). */
  nps: NpsSummary;
  csat: CsatSummary;
}

/**
 * Every tag on a readable response with its counts, most unhappy first,
 * then most used, then by name.
 */
export function tagCounts(rs: readonly NpsResponse[]): TagCount[] {
  const byTag = new Map<string, NpsResponse[]>();
  for (const r of rs) {
    if (!readable(r)) continue;
    for (const tag of normalizeTags(r.tags ?? [])) {
      const list = byTag.get(tag);
      if (list) list.push(r);
      else byTag.set(tag, [r]);
    }
  }
  const out = Array.from(byTag, ([tag, list]): TagCount => {
    const nps = summarizeNps(list);
    const csat = summarizeCsat(list);
    const dissatisfied = list.filter(
      (r) => r.kind === "csat" && csatCategory(r.score) === "dissatisfied"
    ).length;
    return {
      tag,
      n: list.length,
      promoters: nps.promoters,
      detractors: nps.detractors,
      satisfied: csat.satisfied,
      dissatisfied,
      unhappy: nps.detractors + dissatisfied,
      nps,
      csat,
    };
  });
  return out.sort(
    (a, b) => b.unhappy - a.unhappy || b.n - a.n || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0)
  );
}

/* ── Periods ────────────────────────────────────────────────────────── */

export type SurveyPeriod = "week" | "month";

export const SURVEY_PERIODS: readonly SurveyPeriod[] = ["week", "month"];

export interface PeriodPoint {
  /** "2026-W42" or "2026-10". */
  period: string;
  /** As people read it: "Week 42, 2026", "Oct 2026". */
  label: string;
  /** The period's first and last day, "YYYY-MM-DD". */
  from: string;
  to: string;
  nps: NpsSummary;
  csat: CsatSummary;
  /** Whether n meets MIN_SAMPLE.surveyPeriod; below it the value shows with a warning. */
  enoughNps: boolean;
  enoughCsat: boolean;
}

export interface PeriodSeriesOptions {
  /** Only responses with this tag. */
  tag?: string;
  /** At most this many periods, the latest kept (default and ceiling: lib/analytics MAX_PERIODS). */
  maxPeriods?: number;
  /**
   * A day ("YYYY-MM-DD"): the series runs on to its period when that is
   * after the last response's, so quiet recent periods show as empty.
   */
  through?: string;
}

export interface PeriodSeries {
  points: PeriodPoint[];
  /** Readable responses with no readable day: counted, never plotted. */
  undated: number;
  /** Responses whose score is off their kind's scale: left out of every number. */
  offScale: number;
}

/**
 * NPS and CSAT per calendar week or month, oldest first, from the first
 * response's period to the last's (or `through`'s), the empty periods kept
 * with n 0 so a quiet stretch never reads as steady.
 */
export function periodSeries(
  rs: readonly NpsResponse[],
  by: SurveyPeriod,
  opts: PeriodSeriesOptions = {}
): PeriodSeries {
  const tag = opts.tag?.trim() ? opts.tag : undefined;
  const byPeriod = new Map<string, NpsResponse[]>();
  let first: string | null = null;
  let last: string | null = null;
  let undated = 0;
  let offScale = 0;
  for (const r of rs) {
    if (tag !== undefined && !hasTag(r, tag)) continue;
    if (!readable(r)) {
      offScale += 1;
      continue;
    }
    const period = periodOf(r.date, by);
    if (period === null) {
      undated += 1;
      continue;
    }
    if (first === null || comparePeriods(period, first) < 0) first = period;
    if (last === null || comparePeriods(period, last) > 0) last = period;
    const list = byPeriod.get(period);
    if (list) list.push(r);
    else byPeriod.set(period, [r]);
  }
  if (first === null || last === null) return { points: [], undated, offScale };
  const through = opts.through ? periodOf(opts.through, by) : null;
  const end = through !== null && comparePeriods(through, last) > 0 ? through : last;
  const cap = opts.maxPeriods ?? MAX_PERIODS;
  const points = periodRange(first, end, by, cap).map((period): PeriodPoint => {
    const list = byPeriod.get(period) ?? [];
    const nps = summarizeNps(list);
    const csat = summarizeCsat(list);
    const bounds = periodBounds(period) as { from: string; to: string };
    return {
      period,
      label: periodLabel(period),
      from: bounds.from,
      to: bounds.to,
      nps,
      csat,
      enoughNps: enoughForPeriod(nps.n),
      enoughCsat: enoughForPeriod(csat.n),
    };
  });
  return { points, undated, offScale };
}

/**
 * The latest period with enough responses of `kind` to read without a
 * warning (the headline card's), or null when none has.
 */
export function latestEnough(points: readonly PeriodPoint[], kind: SurveyKind): PeriodPoint | null {
  for (let i = points.length - 1; i >= 0; i--) {
    if (kind === "nps" ? points[i].enoughNps : points[i].enoughCsat) return points[i];
  }
  return null;
}
