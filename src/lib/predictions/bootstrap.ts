"use client";

import { mean, quantile } from "../analytics/anomaly";
import {
  forecastBayesianHolt,
  bayesianForecastConfidence,
} from "../analytics/forecasting-bayesian";
import { bootstrapQuantile } from "../analytics/bootstrap";
import { registerPredictor } from "./registry";

let bootstrapped = false;

/**
 * Register all built-in predictors. Call once from the root layout.
 *
 * Each predictor reads from `ctx.workspace` and/or `ctx.history` and
 * returns a `PredictResult`. They're intentionally small and pure — heavy
 * work belongs in `src/lib/analytics/*`.
 */
export function bootstrapPredictions(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  // ── velocity / capacity-planner ──────────────────────────────────────
  registerPredictor<number>("velocity", "nextSprintPlan", (ctx) => {
    const completed = ctx.workspace.sprints.filter(
      (s) => s.status === "completed" && Number.isFinite(s.pointsCompleted)
    );
    const series = completed.map((s) => s.pointsCompleted ?? 0);
    if (series.length === 0) return { value: 0, confidence: "none" };
    const fc = forecastBayesianHolt(series, 1, { priorWeight: 2 });
    if (fc.length === 0)
      return {
        value: Math.round(mean(series)),
        confidence: "low",
        source: "mean of completed sprints",
      };
    const point = Math.round(fc[0].yHat);
    return {
      value: point,
      ciLow: Math.round(fc[0].lower80),
      ciHigh: Math.round(fc[0].upper80),
      confidence: bayesianForecastConfidence(series),
      source: `Bayesian Holt forecast over ${series.length} sprints`,
    };
  });

  registerPredictor<number>("capacity-planner", "pointsCommitted", (ctx) => {
    const completed = ctx.workspace.sprints.filter(
      (s) => s.status === "completed" && Number.isFinite(s.pointsCompleted)
    );
    const series = completed.map((s) => s.pointsCompleted ?? 0);
    if (series.length === 0) return { value: 0, confidence: "none" };
    const fc = forecastBayesianHolt(series, 1, { priorWeight: 2 });
    const point = fc.length > 0 ? Math.round(fc[0].yHat) : Math.round(mean(series));
    return {
      value: point,
      confidence: bayesianForecastConfidence(series),
      source: `Bayesian forecast across ${series.length} completed sprints`,
    };
  });

  // ── burndown ─────────────────────────────────────────────────────────
  registerPredictor<number>("burndown", "idealSlope", (ctx) => {
    const completed = ctx.workspace.sprints.filter((s) => s.status === "completed");
    if (completed.length < 2) return { value: 1, confidence: "none" };
    // Approximate ideal slope = average daily burn during prior completed sprints.
    // Skip sprints whose dates fail to parse — `daysBetween` returns NaN there
    // and the previous `Math.max(1, NaN)` propagated NaN through to the predictor
    // value, matching the same filter applied to impediments/risks below.
    const burns = completed
      .map((s) => {
        const days = daysBetween(s.startDate, s.endDate);
        if (!Number.isFinite(days) || days <= 0) return NaN;
        return (s.pointsPlanned ?? 0) / days;
      })
      .filter((b) => Number.isFinite(b));
    if (burns.length < 2) return { value: 1, confidence: "none" };
    return {
      value: Math.round(mean(burns) * 10) / 10,
      confidence: burns.length >= 4 ? "medium" : "low",
      source: `Mean burn-rate across ${burns.length} prior sprints`,
    };
  });

  // ── cycle-time / kanban ──────────────────────────────────────────────
  registerPredictor<number>("cycle-time", "sleTargetDays", (ctx) => {
    // Read from history of cycle-time entries. Workspace doesn't carry per-
    // story timestamps, so any value we'd return here is a guess. Always
    // return confidence: "none" so the predicted-default chip stays hidden
    // and the local fallback (computed from in-tool entries) wins. Touching
    // ctx so the registered signature still resolves; remove when the
    // workspace carries cycle-time history.
    void ctx;
    return { value: 5, confidence: "none" };
  });

  // ── impediments ──────────────────────────────────────────────────────
  registerPredictor<number>("impediments", "expectedResolutionDays", (ctx) => {
    const resolved = ctx.workspace.impediments
      .filter((i) => i.resolvedAt)
      .map((i) => daysBetween(i.raisedAt, i.resolvedAt!))
      .filter((d) => Number.isFinite(d) && d >= 0);
    if (resolved.length < 3) return { value: 3, confidence: "none" };
    const sorted = resolved.slice().sort((a, b) => a - b);
    return {
      value: Math.round(quantile(sorted, 0.5)),
      ciHigh: Math.round(quantile(sorted, 0.85)),
      confidence: resolved.length >= 8 ? "high" : "medium",
      source: `Median across ${resolved.length} resolved impediments`,
    };
  });

  // ── tech-debt ────────────────────────────────────────────────────────
  registerPredictor<number>("tech-debt", "interestRate", (ctx) => {
    const items = ctx.workspace.techDebt;
    if (items.length === 0) return { value: 0, confidence: "none" };
    const rates = items.map((i) => i.interestRate ?? 0).filter((r) => Number.isFinite(r) && r > 0);
    if (rates.length === 0) return { value: 0.1, confidence: "low", source: "default" };
    return {
      value: Math.round(mean(rates) * 100) / 100,
      confidence: rates.length >= 5 ? "medium" : "low",
      source: `Mean across ${rates.length} prior tech-debt items`,
    };
  });

  // ── okrs ─────────────────────────────────────────────────────────────
  registerPredictor<number>("okrs", "krTargetExtrapolation", (ctx) => {
    const okrs = ctx.workspace.okrs;
    const allKrs = okrs.flatMap((o) => o.keyResults);
    if (allKrs.length === 0) return { value: 100, confidence: "none" };
    // Average target as a starting suggestion.
    const targets = allKrs.map((k) => k.target).filter((t) => Number.isFinite(t));
    if (targets.length === 0) return { value: 100, confidence: "none" };
    return {
      value: Math.round(mean(targets)),
      confidence: targets.length >= 5 ? "medium" : "low",
      source: `Mean target across ${targets.length} prior KRs`,
    };
  });

  // ── risk-register ────────────────────────────────────────────────────
  registerPredictor<number>("risk-register", "mitigationDays", (ctx) => {
    const closed = ctx.workspace.risks
      .filter((r) => r.status === "closed" && r.resolvedAt)
      .map((r) => daysBetween(r.raisedAt, r.resolvedAt!))
      .filter((d) => Number.isFinite(d) && d >= 0);
    if (closed.length < 3) return { value: 14, confidence: "none" };
    const sorted = closed.slice().sort((a, b) => a - b);
    return {
      value: Math.round(quantile(sorted, 0.5)),
      ciHigh: Math.round(quantile(sorted, 0.85)),
      confidence: closed.length >= 8 ? "high" : "medium",
      source: `Median across ${closed.length} closed risks`,
    };
  });

  // ── kanban: WIP limit ────────────────────────────────────────────────
  registerPredictor<number>("kanban", "wipLimit", (ctx) => {
    const inProgress = ctx.workspace.stories.filter((s) => s.status === "in_progress").length;
    if (inProgress === 0) return { value: 3, confidence: "low", source: "default" };
    return {
      value: Math.max(2, Math.round(inProgress * 1.2)),
      confidence: "medium",
      source: `120% of current in-progress count (${inProgress})`,
    };
  });

  // ── release-planner ──────────────────────────────────────────────────
  registerPredictor<number>("release-planner", "sprintsToRelease", (ctx) => {
    const completed = ctx.workspace.sprints.filter(
      (s) => s.status === "completed" && Number.isFinite(s.pointsCompleted)
    );
    if (completed.length === 0) return { value: 4, confidence: "none" };
    const v = mean(completed.map((s) => s.pointsCompleted ?? 0));
    if (v <= 0) return { value: 4, confidence: "low", source: "fallback" };
    const totalScope = ctx.workspace.stories
      .filter((s) => s.status !== "done")
      .reduce((a, s) => a + (s.points ?? 0), 0);
    return {
      value: Math.max(1, Math.ceil(totalScope / v)),
      confidence: completed.length >= 4 ? "medium" : "low",
      source: `${totalScope}pt remaining ÷ avg velocity ${Math.round(v)}`,
    };
  });

  // ── slo-builder ──────────────────────────────────────────────────────
  registerPredictor<number>("slo-builder", "errorBudgetMinutes", () => {
    // Default for a 99.9% SLO over a 30-day window: 43.2 minutes/month.
    return { value: 43, confidence: "medium", source: "99.9% SLO over 30-day window" };
  });

  // ── dora-scorecard ───────────────────────────────────────────────────
  registerPredictor<number>("dora-scorecard", "deploysPerWeekTarget", () => {
    // Industry "high" threshold: 7 deploys/week.
    return { value: 7, confidence: "low", source: "DORA 'High' performer threshold" };
  });

  // ── sprint-goal ──────────────────────────────────────────────────────
  registerPredictor<number>("sprint-goal", "successThresholdPct", (ctx) => {
    const completed = ctx.workspace.sprints.filter(
      (s) => s.status === "completed" && Number.isFinite(s.pointsCompleted) && s.pointsPlanned > 0
    );
    if (completed.length < 3) return { value: 80, confidence: "none" };
    const ratios = completed.map((s) => Math.min(1.5, (s.pointsCompleted ?? 0) / s.pointsPlanned));
    return {
      value: Math.round(mean(ratios) * 100),
      confidence: completed.length >= 5 ? "medium" : "low",
      source: `Mean completion ratio across ${completed.length} sprints`,
    };
  });

  // ── vuln-burndown ────────────────────────────────────────────────────
  registerPredictor<number>("vuln-burndown", "slaDaysCritical", () => {
    return { value: 7, confidence: "medium", source: "common SLA: 7 days for critical vulns" };
  });

  // ── oncall-roster ────────────────────────────────────────────────────
  registerPredictor<number>("oncall-roster", "expectedPagesPerWeek", () => {
    // Without page-history in workspace, default to 5 pages/week.
    return { value: 5, confidence: "low", source: "default (no historical pages in workspace)" };
  });
}

function daysBetween(a: string, b: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/;
  const am = m.exec(a);
  const bm = m.exec(b);
  if (!am || !bm) return NaN;
  const ad = new Date(Number(am[1]), Number(am[2]) - 1, Number(am[3]));
  const bd = new Date(Number(bm[1]), Number(bm[2]) - 1, Number(bm[3]));
  return Math.round((bd.getTime() - ad.getTime()) / 86_400_000);
}

// Touch the imports so a future bundler doesn't tree-shake them when no
// predictor uses them yet. Used by Tier-1 tools later.
void bootstrapQuantile;
