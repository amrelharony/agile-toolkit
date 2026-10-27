/**
 * Cost of Quality Calculator — tool-local actions.
 *
 * Category: Quality Engineering (squad S10)
 * Tool:     The cost-of-quality (CoQ) trade-off across prevention, detection
 *           (appraisal) and failure costs, logged quarter by quarter, with
 *           the failure share's trend.
 *
 * Agent surface: tool.quality_cost.*
 *
 * The page keeps its figures in its cloud-synced blob (QUALITY_COST_KEY):
 * no other tool writes them, so they stay there and agents read them; the
 * manifest sets no usesWorkspace and there is no workspace entity. Both
 * actions share lib/quality/cost with the page, so the numbers agree.
 *
 *   1. compute_cost_of_quality — figures (or hours × a rate) → conformance /
 *      non-conformance / total and the failure share. Pure: no mcpHandler,
 *      it runs the same on the server and in the browser.
 *   2. list_periods — the saved quarters with their breakdowns, the failure
 *      share's trend and the verdict, plus the figures from before periods
 *      while they haven't been saved as a quarter. Read-only: the browser's
 *      localStorage copy of the blob, or the user's user_state row.
 */

import { z } from "zod";
import { registry } from "../registry";
import { serverGetUserStateBlob } from "../server-store";
import {
  COST_CATEGORIES,
  LEGACY_COST_FIELD,
  QUALITY_COST_KEY,
  costBreakdown,
  costsWithHours,
  failureShareTrend,
  failureShareVerdict,
  legacyCosts,
  normalizeQualityCostState,
  type CostBreakdown,
  type CostFigures,
} from "@/lib/quality/cost";

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
const round4OrNull = (n: number | null) => (n === null ? null : round4(n));

/** A breakdown for an agent: shares to 4 decimals. */
function breakdownOut(b: CostBreakdown) {
  return {
    entered: b.entered,
    missing: b.missing,
    total: b.total,
    conformance: b.conformance,
    nonConformance: b.nonConformance,
    failureShare: round4OrNull(b.failureShare),
    externalToInternal: round4OrNull(b.externalToInternal),
  };
}

// ──────── tool.quality_cost.compute_cost_of_quality ────────

const Amount = z.number().finite().min(0);

registry.register({
  id: "tool.quality_cost.compute_cost_of_quality",
  toolId: "tool.quality_cost",
  name: "compute_cost_of_quality",
  category: "read",
  description:
    "Compute the cost-of-quality breakdown. Each cost is optional (left out = not entered, never 0). A cost left out but given as hours is filled as hours × hourlyRate. conformance = prevention + detection; nonConformance = internal + external failure; totalCoq = conformance + nonConformance. Returns {conformance, nonConformance, totalCoq, conformancePct and failurePct (0..1 of total; 0 when total is 0, kept for older callers), failureShare (0..1; null when total is 0 or nothing was entered on one side), externalToInternal (null unless both failure costs were entered and internal > 0), entered (count), missing (categories), costs (as used), filledFromHours, needRate (categories with hours but no hourlyRate)}. Pure — no persistence.",
  paramsSchema: z.object({
    preventionCost: Amount.optional(),
    detectionCost: Amount.optional().describe("Appraisal/detection cost."),
    internalFailureCost: Amount.optional(),
    externalFailureCost: Amount.optional(),
    hours: z
      .object({
        prevention: Amount.optional(),
        detection: Amount.optional(),
        internalFailure: Amount.optional(),
        externalFailure: Amount.optional(),
      })
      .optional()
      .describe("Hours per category, costed at hourlyRate where no amount is given."),
    hourlyRate: Amount.optional().describe("The blended hourly rate for the hours."),
  }),
  handler: async (params) => {
    const given: CostFigures = {};
    for (const c of COST_CATEGORIES) {
      // The params keep the page's old field names (preventionCost …).
      const v = params[LEGACY_COST_FIELD[c]];
      if (v !== undefined) given[c] = v;
    }
    const filled = costsWithHours(given, params.hours, params.hourlyRate);
    const b = costBreakdown(filled.costs);
    return {
      conformance: b.conformance,
      nonConformance: b.nonConformance,
      totalCoq: b.total,
      conformancePct: b.total ? round2(b.conformance / b.total) : 0,
      failurePct: b.total ? round2(b.nonConformance / b.total) : 0,
      failureShare: round4OrNull(b.failureShare),
      externalToInternal: round4OrNull(b.externalToInternal),
      entered: b.entered,
      missing: b.missing,
      costs: filled.costs,
      filledFromHours: filled.filled,
      needRate: filled.needRate,
    };
  },
  // No mcpHandler — pure compute runs identically on server and client.
});

// ──────── tool.quality_cost.list_periods ────────

/** The blob as the page's usePersisted hydrates it, or null. */
function browserBlob(): unknown {
  try {
    const raw =
      typeof window === "undefined" ? null : window.localStorage.getItem(QUALITY_COST_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function listPeriods(raw: unknown) {
  const state = normalizeQualityCostState(raw);
  const periods = state.periods ?? [];
  const trend = failureShareTrend(periods);
  const legacy = legacyCosts(state);
  const point = (p: { period: string; share: number | null; total: number } | null) =>
    p ? { period: p.period, share: round4OrNull(p.share), total: p.total } : null;
  return {
    exists: raw !== null && raw !== undefined,
    hourlyRate: state.hourlyRate ?? null,
    periods: periods.map((p) => ({
      id: p.id,
      period: p.period,
      costs: p.costs,
      hours: p.hours ?? null,
      note: p.note ?? null,
      ...breakdownOut(costBreakdown(p.costs)),
    })),
    trend: {
      points: trend.points.map(point),
      latest: point(trend.latest),
      previous: point(trend.previous),
      changeVsPrevious: round4OrNull(trend.changeVsPrevious),
      mannKendall: trend.trend
        ? {
            trend: trend.trend.trend,
            significant: trend.trend.significant,
            pValue: round4(trend.trend.pValue),
          }
        : null,
    },
    verdict: failureShareVerdict(trend),
    legacy: legacy
      ? {
          costs: legacy,
          description: state.description ?? null,
          ...breakdownOut(costBreakdown(legacy)),
        }
      : null,
  };
}

registry.register({
  id: "tool.quality_cost.list_periods",
  toolId: "tool.quality_cost",
  name: "list_periods",
  category: "read",
  description:
    "The quarters saved on the Cost of Quality page, oldest first. Returns {exists, hourlyRate (null until entered), periods: {id, period ('2026-Q3'), costs (per category: prevention, detection, internalFailure, externalFailure; a category left out wasn't entered), hours, note, entered, missing, total, conformance, nonConformance, failureShare (0..1 or null), externalToInternal}[], trend: {points: {period, share, total}[], latest, previous, changeVsPrevious (share points as 0..1, null without two quarters), mannKendall (null below 6 quarters)}, verdict (one sentence, null without a share), legacy (the single set of figures from before periods, not yet saved as a quarter; null when none)}. Read-only.",
  paramsSchema: z.object({}),
  handler: async () => listPeriods(browserBlob()),
  mcpHandler: async (_params, ctx) =>
    listPeriods(await serverGetUserStateBlob(ctx.userId, QUALITY_COST_KEY)),
});
