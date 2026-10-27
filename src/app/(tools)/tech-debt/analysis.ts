/**
 * Tech Debt: the numbers behind the hotspot matrix, the age and score on
 * each row, and the time to pay debt down in "Advanced analysis". Pure.
 *
 * Every age, score and rank comes from lib/tech-debt/model (the one
 * reading the agent and the next steps use); this module only arranges
 * them. Ages are whole sprints of the team's cadence (calendar days ÷
 * sprintLengthDays, 14 when the team hasn't set one).
 */

import { bootstrapQuantile } from "@/lib/analytics/bootstrap";
import { enoughData } from "@/lib/analytics/min-sample";
import { kaplanMeier, medianSurvivalTime } from "@/lib/analytics/survival";
import { fmt, type ChartText } from "@/lib/charts/chart-text";
import type { TechDebtItem } from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";
import {
  INTEREST_CAP,
  debtAgeDays,
  debtScale,
  isOpenDebt,
  type DebtScore,
} from "@/lib/tech-debt/model";

/**
 * The items the page's numbers read: the team's own while there are any
 * (the example's are listed but not counted, as the agent and the next
 * steps leave them out), else the example's, so a loaded example shows
 * its own verdict and matrix. lib/tech-debt leaves example ids out of
 * every count by default, so the page reads these rows with
 * `{ includeExamples: true }`: they never mix the example's in with the
 * team's own.
 */
export function countedDebt(records: readonly TechDebtItem[]): TechDebtItem[] {
  const real = records.filter((t) => !isExampleId(t.id));
  return real.length > 0 ? real : [...records];
}

/**
 * The items the Markdown and the CSV list: the same set countedDebt
 * counts, so an export never mixes the example's made-up rows in with the
 * numbers it quotes.
 */
export const exportedDebt = countedDebt;

/* ── Age and score on a row ────────────────────────────────────────────── */

/**
 * "≈ 4 sprints (14-day sprints)": the age the score counts, in whole
 * sprints of the team's cadence, with the length it divides by.
 */
export function ageLabel(ageSprints: number | null, sprintLengthDays: number): string {
  const basis = `(${sprintLengthDays}-day sprints)`;
  if (ageSprints === null) return "Age unknown: no raised day";
  if (ageSprints === 0) return `Under a sprint old ${basis}`;
  return `≈ ${ageSprints} ${ageSprints === 1 ? "sprint" : "sprints"} ${basis}`;
}

/** "4 × 4 − 2 + 10 interest (capped at 10)": how the score adds up. */
export function scoreSum(item: Pick<TechDebtItem, "impact" | "effort">, score: DebtScore): string {
  const base = `${debtScale(item.impact)} × 4 − ${debtScale(item.effort)}`;
  if (score.interest === 0) return base;
  return `${base} + ${fmt(score.interest)} interest${score.capped ? ` (capped at ${INTEREST_CAP})` : ""}`;
}

/* ── The hotspot matrix ────────────────────────────────────────────────── */

/**
 * Open items per cell, [impact − 1][effort − 1]; a stored rating off the
 * scale reads as lib/tech-debt reads it (rounded, clamped, 3 when it isn't
 * a number).
 */
export function hotspotGrid(items: readonly TechDebtItem[]): { grid: number[][]; open: number } {
  const grid = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => 0));
  let open = 0;
  for (const t of items) {
    if (!isOpenDebt(t)) continue;
    grid[debtScale(t.impact) - 1][debtScale(t.effort) - 1] += 1;
    open += 1;
  }
  return { grid, open };
}

/** The accent tint for a cell with `count` items: stronger with more, never a hex. */
export function heatTone(count: number): string {
  if (count <= 0) return "border-border text-sub";
  if (count === 1) return "border-accent/30 bg-accent/10 text-text";
  if (count === 2) return "border-accent/40 bg-accent/20 text-text";
  if (count <= 4) return "border-accent/50 bg-accent/30 text-text";
  return "border-accent/60 bg-accent/50 text-text";
}

/* ── Time to pay down ──────────────────────────────────────────────────── */

export interface DebtSurvival {
  /** Items paid down. */
  resolved: number;
  /** The Kaplan-Meier curve: the share still open after `t` days. Empty below the minimum. */
  points: { t: number; survival: number }[];
  /** The curve's median (days), or null below MIN_SAMPLE.distribution resolved or while fewer than half are. */
  medianDays: number | null;
  /** A 95% bootstrap interval on the median days of the resolved items; null below the minimum. */
  interval: { low: number; high: number } | null;
}

/**
 * How long debt takes to pay down: days raised → resolved (lib/tech-debt
 * debtAgeDays), open items counted as still waiting at today. Below
 * MIN_SAMPLE.distribution resolved items nothing is estimated. The
 * agent's list_state gives the same median (tool.tech_debt:
 * timeToResolve).
 */
export function timeToResolve(items: readonly TechDebtItem[], today: string): DebtSurvival {
  const observations = items.flatMap((t) => {
    const duration = debtAgeDays(t, today);
    return duration === null ? [] : [{ duration, event: !isOpenDebt(t) }];
  });
  const durations = observations.filter((o) => o.event).map((o) => o.duration);
  if (!enoughData(durations.length, "distribution")) {
    return { resolved: durations.length, points: [], medianDays: null, interval: null };
  }
  const curve = kaplanMeier(observations);
  const ci = bootstrapQuantile(durations, 0.5);
  return {
    resolved: durations.length,
    points: curve.map((p) => ({ t: p.t, survival: Math.round(p.survival * 1000) / 1000 })),
    medianDays: medianSurvivalTime(curve),
    interval:
      Number.isFinite(ci.lower) && Number.isFinite(ci.upper)
        ? { low: Math.round(ci.lower), high: Math.round(ci.upper) }
        : null,
  };
}

/** The survival chart's summary and its points as a table. */
export function survivalChartText(s: DebtSurvival): ChartText {
  const table = {
    columns: ["Days since raised", "Still open"],
    rows: s.points.map((p) => [p.t, `${Math.round(p.survival * 100)}%`]),
    caption: "Share of debt items still open after each number of days",
  };
  const median =
    s.medianDays === null
      ? "Fewer than half the items have been paid down, so there is no median yet"
      : `Half the items are paid down within ${s.medianDays} ${s.medianDays === 1 ? "day" : "days"}`;
  const interval = s.interval
    ? ` (95% interval ${s.interval.low}–${s.interval.high} days over the ${s.resolved} paid down)`
    : "";
  return {
    summary: `${median}${interval}. Open items count as still waiting.`,
    table,
  };
}
