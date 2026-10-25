/**
 * Feature Flag Tracker: the age chart's data and text, and the advanced
 * statistics, each behind its minimum sample: how long flags live before
 * they're retired (Kaplan-Meier, live flags still at risk) and whether
 * the team is adding flags faster or slower (Mann-Kendall over ISO weeks).
 * Pure.
 */

import type { FeatureFlag, FeatureFlagPurpose } from "@/lib/stores/workspace-types";
import { FLAG_PURPOSES, PURPOSE_LABEL, flagAgeDays, flagLifetimes } from "@/lib/flags/model";
import { kaplanMeier, medianSurvivalTime, type SurvivalCurvePoint } from "@/lib/analytics/survival";
import { bootstrapQuantile } from "@/lib/analytics/bootstrap";
import { mannKendall, type MannKendallResult } from "@/lib/analytics/trend-test";
import { enoughData } from "@/lib/analytics/min-sample";
import { fmt, plural, type ChartText } from "@/lib/charts/chart-text";
import { throughputByWeek, weekOf, type ThroughputPoint } from "@/lib/flow";

/** The live flags' age bands, in days, both ends included. */
export const AGE_BUCKETS = [
  { label: "0–30 days", min: 0, max: 30 },
  { label: "31–60 days", min: 31, max: 60 },
  { label: "61–90 days", min: 61, max: 90 },
  { label: "91–180 days", min: 91, max: 180 },
  { label: "Over 180 days", min: 181, max: Infinity },
] as const;

export interface AgeBucket {
  bucket: string;
  count: number;
  byPurpose: Record<FeatureFlagPurpose, number>;
}

/** Live flags by age band, with each band's purposes. A flag with no created day is left out. */
export function ageBuckets(flags: readonly FeatureFlag[], today: string): AgeBucket[] {
  const out: AgeBucket[] = AGE_BUCKETS.map((b) => ({
    bucket: b.label,
    count: 0,
    byPurpose: { rollout: 0, experiment: 0, kill_switch: 0, permission: 0 },
  }));
  for (const f of flags) {
    if (f.status === "retired") continue;
    const age = flagAgeDays(f, today);
    if (age === null) continue;
    const i = AGE_BUCKETS.findIndex((b) => age >= b.min && age <= b.max);
    if (i < 0) continue;
    out[i].count++;
    out[i].byPurpose[f.purpose]++;
  }
  return out;
}

export function ageChartText(
  buckets: readonly AgeBucket[],
  flags: readonly FeatureFlag[],
  today: string
): ChartText {
  const live = buckets.reduce((a, b) => a + b.count, 0);
  const oldest = flags
    .filter((f) => f.status !== "retired")
    .map((f) => ({ f, age: flagAgeDays(f, today) }))
    .filter((x): x is { f: FeatureFlag; age: number } => x.age !== null)
    .sort((a, b) => b.age - a.age)[0];
  const over90 = buckets.slice(3).reduce((a, b) => a + b.count, 0);
  const summary =
    live === 0
      ? "No live flags."
      : `${plural(live, "live flag")}; ${over90 === 0 ? "none is" : `${over90} ${over90 === 1 ? "is" : "are"}`} over 90 days old${
          oldest
            ? `. The oldest is ${oldest.f.name || "an unnamed flag"}, at ${plural(oldest.age, "day")}`
            : ""
        }.`;
  return {
    summary,
    table: {
      columns: ["Age", "Live flags", ...FLAG_PURPOSES.map((p) => PURPOSE_LABEL[p])],
      rows: buckets.map((b) => [b.bucket, b.count, ...FLAG_PURPOSES.map((p) => b.byPurpose[p])]),
    },
  };
}

/* ── Survival ───────────────────────────────────────────────────────── */

export interface Survival {
  /** Retired flags with a retired day: the events. */
  retired: number;
  curve: SurvivalCurvePoint[];
  /** Days by which half the flags were retired, or null when fewer than half are. */
  median: number | null;
  /** A 95% bootstrap interval on the median lifetime of the retired flags. */
  ci: { lower: number; upper: number } | null;
}

/**
 * How long flags live, from created to retired, with live flags counted as
 * still at risk. Null below the distribution sample of retired flags.
 */
export function flagSurvival(flags: readonly FeatureFlag[], today: string): Survival | null {
  const lifetimes = flagLifetimes(flags, today);
  const retired = lifetimes.filter((l) => l.retired);
  if (!enoughData(retired.length, "distribution")) return null;
  const curve = kaplanMeier(lifetimes.map((l) => ({ duration: l.days, event: l.retired })));
  const ci = bootstrapQuantile(
    retired.map((l) => l.days),
    0.5
  );
  return {
    retired: retired.length,
    curve,
    median: medianSurvivalTime(curve),
    ci:
      Number.isFinite(ci.lower) && Number.isFinite(ci.upper)
        ? { lower: ci.lower, upper: ci.upper }
        : null,
  };
}

/** How many retired flags carry a retired day (what the survival curve needs). */
export const retiredWithDays = (flags: readonly FeatureFlag[], today: string) =>
  flagLifetimes(flags, today).filter((l) => l.retired).length;

export function survivalChartText(s: Survival): ChartText {
  const at = (t: number) => {
    let last = 1;
    for (const p of s.curve) {
      if (p.t <= t) last = p.survival;
      else break;
    }
    return last;
  };
  const summary = `${plural(s.retired, "retired flag")}, live flags still at risk. ${
    s.median === null
      ? "Fewer than half the flags have been retired, so there's no median lifetime yet."
      : `Half the flags were retired within ${plural(s.median, "day")}${
          s.ci ? ` (95% interval ${fmt(s.ci.lower, 0)}–${fmt(s.ci.upper, 0)} days)` : ""
        }.`
  } ${fmt(at(90) * 100, 0)}% are still live after 90 days.`;
  return {
    summary,
    table: {
      columns: ["Day", "Still live", "At risk", "Retired that day"],
      rows: s.curve.map((p) => [p.t, `${fmt(p.survival * 100, 0)}%`, p.atRisk, p.events]),
    },
  };
}

/* ── Creation trend ─────────────────────────────────────────────────── */

/** The latest weeks the trend reads. */
export const TREND_WEEKS = 26;

/**
 * Flags created per ISO week (quiet weeks as 0), the latest `TREND_WEEKS`
 * up to `today`'s week. lib/flow's weekly series ends at the last week
 * with an item, which would leave out the quiet weeks since the last flag
 * and read a team that stopped adding flags as having no trend; one
 * stand-in item dated today stretches it to this week, then comes off.
 */
export function createdPerWeek(flags: readonly FeatureFlag[], today: string): ThroughputPoint[] {
  const created = flags
    .filter((f) => f.createdAt && f.createdAt <= today)
    .map((f) => ({ doneOn: f.createdAt }));
  if (created.length === 0) return [];
  const thisWeek = weekOf(today);
  return throughputByWeek([...created, { doneOn: today }])
    .map((w) => (w.label === thisWeek ? { ...w, value: w.value - 1 } : w))
    .slice(-TREND_WEEKS);
}

/**
 * A direction of travel in flags created per week; null below the trend
 * sample, or with fewer than three weeks that saw a flag (a series of
 * zeros is all ties, and its "trend" is noise).
 */
export function creationTrend(weeks: readonly ThroughputPoint[]): MannKendallResult | null {
  if (!enoughData(weeks.length, "trend")) return null;
  if (weeks.filter((w) => w.value > 0).length < 3) return null;
  return mannKendall(weeks.map((w) => w.value));
}

export function trendSentence(trend: MannKendallResult, weeks: number): string {
  if (!trend.significant)
    return `No significant change in flags created per week over ${plural(weeks, "week")}.`;
  return `The team is creating flags ${trend.trend === "up" ? "faster" : "more slowly"} over ${plural(
    weeks,
    "week"
  )} (Mann-Kendall p = ${fmt(trend.pValue, 3)}).`;
}
