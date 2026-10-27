/**
 * Cost of Quality: what a team spends on prevention and detection
 * (conformance) against what failures cost it (non-conformance), quarter
 * by quarter. The page keeps it in its cloud-synced blob (QUALITY_COST_KEY;
 * no other tool writes it), and the page and tool.quality_cost.* read it
 * through these functions, so a person and an agent get the same failure
 * share.
 *
 * Pure and server-safe: no React, nothing from components (the agent's
 * server bundle imports it).
 *
 *   - A cost that wasn't entered is absent, never $0. Totals add what was
 *     entered, and a failure share needs a figure on each side: with only
 *     failure costs typed, "100% failure" would be the form's say-so.
 *   - The blob from before Phase 8 held one set of figures at the top level
 *     (preventionCost …), all 0 until typed. They stay where they are and
 *     read as legacy figures (`legacyCosts`) until the person saves them as
 *     a quarter: no quarter is ever assigned to them.
 *   - Periods are quarters, stored as the dash form "2026-Q3", one each.
 */

import { nanoid } from "nanoid";
import { enoughData } from "@/lib/analytics/min-sample";
import { comparePeriods } from "@/lib/analytics/periods";
import { mannKendall, type MannKendallResult } from "@/lib/analytics/trend-test";
import { dashQuarter, quarterIndex } from "@/lib/roadmap/quarters";
import { parseNumber, type FormErrors } from "@/lib/utils/form";

/** The page's cloud-synced blob (a `user_state` row when signed in). */
export const QUALITY_COST_KEY = "agile-toolkit:quality-cost";

export type CostCategory = "prevention" | "detection" | "internalFailure" | "externalFailure";

export const COST_CATEGORIES: readonly CostCategory[] = [
  "prevention",
  "detection",
  "internalFailure",
  "externalFailure",
];

/** Spending to get it right: conformance. */
export const CONFORMANCE_CATEGORIES: readonly CostCategory[] = ["prevention", "detection"];
/** What getting it wrong cost: non-conformance. */
export const FAILURE_CATEGORIES: readonly CostCategory[] = ["internalFailure", "externalFailure"];

export const COST_CATEGORY_LABEL: Record<CostCategory, string> = {
  prevention: "Prevention",
  detection: "Detection (appraisal)",
  internalFailure: "Internal failure",
  externalFailure: "External failure",
};

/** The top-level field each category used before periods. */
export const LEGACY_COST_FIELD = {
  prevention: "preventionCost",
  detection: "detectionCost",
  internalFailure: "internalFailureCost",
  externalFailure: "externalFailureCost",
} as const satisfies Record<CostCategory, string>;

/**
 * Above this share of the quality spend, failure costs read as high: the
 * page's danger tone and the verdict's warning (the old page's "> 30%").
 */
export const FAILURE_SHARE_HIGH = 0.3;

/** A period note or the legacy description. */
export const QUALITY_COST_NOTE_MAX = 2000;

/** Costs per category; a category left out wasn't entered. */
export type CostFigures = Partial<Record<CostCategory, number>>;

/** One quarter's figures. */
export interface QualityCostPeriod {
  /** `qcp_<nanoid8>`, or `example-…` in the example. */
  id: string;
  /** The quarter, dash form: "2026-Q3". */
  period: string;
  /** Money per category; absent = not entered. */
  costs: CostFigures;
  /** Hours behind a cost worked out as hours × the hourly rate, kept to show how. */
  hours?: Partial<Record<CostCategory, number>>;
  note?: string;
}

/** The page's blob. Every field is optional: an empty blob is a first run. */
export interface QualityCostState {
  /** Legacy single-period figures (before Phase 8); 0 until typed. */
  preventionCost?: number;
  detectionCost?: number;
  internalFailureCost?: number;
  externalFailureCost?: number;
  /** Legacy note on those figures. */
  description?: string;
  /** Quarters, oldest first. */
  periods?: QualityCostPeriod[];
  /** The blended hourly rate for hours × rate; unset until typed. */
  hourlyRate?: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** A stored amount: a finite number, 0 or more. */
const isAmount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The amounts in `raw` under the category keys; anything else is left out. */
function figuresOf(raw: unknown): CostFigures {
  const out: CostFigures = {};
  if (!isRecord(raw)) return out;
  for (const c of COST_CATEGORIES) if (isAmount(raw[c])) out[c] = raw[c];
  return out;
}

/** The quarter of a stored period as the dash form, or null when it can't be read. */
export function costPeriodQuarter(period: unknown): string | null {
  const q = typeof period === "string" ? quarterIndex(period) : 0;
  return q === 0 ? null : dashQuarter(q);
}

function normalizePeriod(raw: unknown): QualityCostPeriod | null {
  if (!isRecord(raw)) return null;
  const period = costPeriodQuarter(raw.period);
  // A row whose quarter can't be read can't be placed on the trend.
  if (period === null) return null;
  const hours = figuresOf(raw.hours);
  return {
    // Rows always carry an id; one without reads as its quarter, so
    // normalising twice gives the same row.
    id: typeof raw.id === "string" && raw.id ? raw.id : `qcp-${period}`,
    period,
    costs: figuresOf(raw.costs),
    ...(Object.keys(hours).length > 0 ? { hours } : {}),
    ...(typeof raw.note === "string" ? { note: raw.note } : {}),
  };
}

/**
 * The blob as stored, made safe to read: amounts that aren't a number of 0
 * or more are left out (never read as 0), periods whose quarter can't be
 * read are left out and the rest sorted oldest first, quarters written
 * "2026 Q3" read as "2026-Q3". The legacy top-level figures stay as they
 * were. Idempotent.
 */
export function normalizeQualityCostState(raw: unknown): QualityCostState {
  if (!isRecord(raw)) return {};
  const out: QualityCostState = {};
  for (const c of COST_CATEGORIES) {
    const field = LEGACY_COST_FIELD[c];
    if (isAmount(raw[field])) out[field] = raw[field];
  }
  if (typeof raw.description === "string") out.description = raw.description;
  if (isAmount(raw.hourlyRate)) out.hourlyRate = raw.hourlyRate;
  if (Array.isArray(raw.periods)) {
    out.periods = raw.periods
      .map(normalizePeriod)
      .filter((p): p is QualityCostPeriod => p !== null)
      .sort((a, b) => comparePeriods(a.period, b.period));
  }
  return out;
}

/**
 * The legacy single-period figures as costs, or null when there are none
 * worth keeping. The old page started every figure at 0, so all four at 0
 * is a first run; once any is above 0, the zeros beside it were on screen
 * as "$0" and are kept as entered.
 */
export function legacyCosts(state: QualityCostState): CostFigures | null {
  const values = COST_CATEGORIES.map((c) => state[LEGACY_COST_FIELD[c]]);
  if (!values.some((v) => isAmount(v) && v > 0)) return null;
  const out: CostFigures = {};
  COST_CATEGORIES.forEach((c, i) => {
    const v = values[i];
    if (isAmount(v)) out[c] = v;
  });
  return out;
}

/** The state with the legacy figures cleared (after "Save as a period" moved them into a quarter). */
export function withoutLegacyCosts(state: QualityCostState): QualityCostState {
  const next: QualityCostState = { ...state };
  for (const c of COST_CATEGORIES) delete next[LEGACY_COST_FIELD[c]];
  delete next.description;
  return next;
}

export interface CostBreakdown {
  /** How many of the four categories were entered. */
  entered: number;
  /** The categories not entered, in COST_CATEGORIES order. */
  missing: CostCategory[];
  /** The entered amounts added up, to the cent. */
  total: number;
  /** Prevention + detection, as entered. */
  conformance: number;
  /** Internal + external failure, as entered. */
  nonConformance: number;
  /**
   * Failure costs as a share (0..1) of the total. Null when the total is 0,
   * or when nothing was entered on one side (conformance or failure).
   */
  failureShare: number | null;
  /** External ÷ internal failure, when both were entered and internal is above 0. */
  externalToInternal: number | null;
}

/** The breakdown of one set of figures. */
export function costBreakdown(costs: CostFigures): CostBreakdown {
  const figures = figuresOf(costs);
  const sum = (cats: readonly CostCategory[]) =>
    round2(cats.reduce((acc, c) => acc + (figures[c] ?? 0), 0));
  const has = (cats: readonly CostCategory[]) => cats.some((c) => figures[c] !== undefined);
  const conformance = sum(CONFORMANCE_CATEGORIES);
  const nonConformance = sum(FAILURE_CATEGORIES);
  const total = round2(conformance + nonConformance);
  const missing = COST_CATEGORIES.filter((c) => figures[c] === undefined);
  const internal = figures.internalFailure;
  const external = figures.externalFailure;
  return {
    entered: COST_CATEGORIES.length - missing.length,
    missing,
    total,
    conformance,
    nonConformance,
    failureShare:
      total > 0 && has(CONFORMANCE_CATEGORIES) && has(FAILURE_CATEGORIES)
        ? nonConformance / total
        : null,
    externalToInternal:
      internal !== undefined && external !== undefined && internal > 0 ? external / internal : null,
  };
}

/**
 * Hours × the hourly rate, to the cent: the guide's way to cost time
 * spent. Null when either isn't a finite number of 0 or more.
 */
export function hoursTimesRate(hours: number, rate: number): number | null {
  if (!isAmount(hours) || !isAmount(rate)) return null;
  const cost = round2(hours * rate);
  return Number.isFinite(cost) ? cost : null;
}

/**
 * The costs with each category that has hours but no amount filled in as
 * hours × `rate`. `filled` names those; `needRate` the ones that had hours
 * but no usable rate to cost them with (left out, never 0). An amount that
 * was entered is never replaced.
 */
export function costsWithHours(
  costs: CostFigures,
  hours: Partial<Record<CostCategory, number>> | undefined,
  rate: number | undefined
): { costs: CostFigures; filled: CostCategory[]; needRate: CostCategory[] } {
  const out = figuresOf(costs);
  const h = figuresOf(hours);
  const filled: CostCategory[] = [];
  const needRate: CostCategory[] = [];
  for (const c of COST_CATEGORIES) {
    if (out[c] !== undefined || h[c] === undefined) continue;
    const cost = rate === undefined ? null : hoursTimesRate(h[c] as number, rate);
    if (cost === null) needRate.push(c);
    else {
      out[c] = cost;
      filled.push(c);
    }
  }
  return { costs: out, filled, needRate };
}

export interface FailureSharePoint {
  period: string;
  /** Null when the quarter's share can't be worked out (see CostBreakdown.failureShare). */
  share: number | null;
  total: number;
}

export interface FailureShareTrend {
  /** Every logged quarter, oldest first. */
  points: FailureSharePoint[];
  /** The last quarter with a share. */
  latest: FailureSharePoint | null;
  /** The quarter with a share before `latest`. */
  previous: FailureSharePoint | null;
  /** latest − previous share (0.08 = 8 points up); null without both. */
  changeVsPrevious: number | null;
  /** Mann-Kendall over the shares, only from MIN_SAMPLE.trend quarters with one. */
  trend: MannKendallResult | null;
}

/** The failure share per quarter, the change on the quarter before, and a trend once there are enough. */
export function failureShareTrend(periods: readonly QualityCostPeriod[]): FailureShareTrend {
  const points = [...periods]
    .sort((a, b) => comparePeriods(a.period, b.period))
    .map((p) => {
      const b = costBreakdown(p.costs);
      return { period: p.period, share: b.failureShare, total: b.total };
    });
  const scored = points.filter((p) => p.share !== null);
  const latest = scored[scored.length - 1] ?? null;
  const previous = scored[scored.length - 2] ?? null;
  return {
    points,
    latest,
    previous,
    changeVsPrevious:
      latest && previous ? (latest.share as number) - (previous.share as number) : null,
    trend: enoughData(scored.length, "trend")
      ? mannKendall(scored.map((p) => p.share as number))
      : null,
  };
}

const pct = (share: number) => Math.round(share * 100);

/**
 * The verdict on the latest quarter, e.g. "Failure costs were 42% of
 * quality spend in 2026-Q3, up 8 points on 2026-Q2. That is above the 30%
 * mark." The move is in whole points of the rounded shares, as they are
 * shown. With one quarter it states the share only; null with none.
 */
export function failureShareVerdict(trend: FailureShareTrend): string | null {
  const { latest, previous } = trend;
  if (!latest || latest.share === null) return null;
  let move = "";
  if (previous && previous.share !== null) {
    const points = pct(latest.share) - pct(previous.share);
    const n = Math.abs(points);
    move =
      points === 0
        ? `, level with ${previous.period}`
        : `, ${points > 0 ? "up" : "down"} ${n} point${n === 1 ? "" : "s"} on ${previous.period}`;
  }
  const high =
    latest.share > FAILURE_SHARE_HIGH ? ` That is above the ${pct(FAILURE_SHARE_HIGH)}% mark.` : "";
  return `Failure costs were ${pct(latest.share)}% of quality spend in ${latest.period}${move}.${high}`;
}

/** A new period's id. */
export function newQualityCostPeriodId(): string {
  return `qcp_${nanoid(8)}`;
}

export type CostPeriodField = "period" | CostCategory;

/**
 * Why a quarter's draft can't be saved: no quarter, one already logged
 * (other than `editingId`), no cost at all (the error sits on the first
 * category), or an amount that isn't a number of 0 or more.
 */
export function costPeriodErrors(
  draft: {
    period: string | null | undefined;
    costs: Partial<Record<CostCategory, string | number | null | undefined>>;
  },
  periods: readonly QualityCostPeriod[],
  editingId?: string
): FormErrors<CostPeriodField> {
  const errors: FormErrors<CostPeriodField> = {};
  const quarter = costPeriodQuarter(draft.period);
  if (!draft.period || !draft.period.trim())
    errors.period = "Pick the quarter these figures are for.";
  else if (quarter === null) errors.period = "Pick a quarter, such as 2026-Q3.";
  else if (periods.some((p) => p.period === quarter && p.id !== editingId)) {
    errors.period = `Already logged: edit ${quarter} below.`;
  }
  let entered = 0;
  for (const c of COST_CATEGORIES) {
    const n = parseNumber(draft.costs[c] ?? undefined);
    if (n === undefined) continue;
    entered += 1;
    if (!isAmount(n)) errors[c] = "Enter an amount of 0 or more.";
  }
  if (entered === 0) errors[COST_CATEGORIES[0]] = "Enter at least one cost.";
  return errors;
}
