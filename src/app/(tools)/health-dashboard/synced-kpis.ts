/**
 * Health Dashboard — KPIs derived from the SYNCED workspace entities.
 *
 * The original dashboard read each tool's isolated localStorage blob, which
 * went stale once the tools migrated to the synced workspace store (and never
 * reflected agent or cross-device writes at all). These pure functions compute
 * the same headline numbers from the authoritative synced entities — the same
 * source of truth the agent's tool.health_dashboard.get_summary reads — so the
 * human dashboard, the agent, and every device finally agree.
 *
 * Each function returns `null` metrics when its source has no data yet, so the
 * dashboard's "N of M data sources connected" UX still distinguishes an unused
 * tool from one reporting a genuine zero.
 *
 * Cycle-time is intentionally absent: it has no synced entity (Story carries no
 * start/end timestamps) and no agent write path, so that card stays on its
 * device-local extractor.
 */

import { todayLocalISO } from "@/lib/utils/formatters";
import type { Sprint, HealthCheck, Impediment, StandupEntry } from "@/lib/stores/workspace-types";
import type { TrendDir } from "./types";

const HEALTH_CHECK_ID = "healthCheck:current";
const LIGHT_SCORE: Record<string, number> = { green: 2, yellow: 1, red: 0 };

/** Half-split mean trend used across velocity + (indirectly) health series. */
function halfSplitTrend(series: number[], threshold: number): TrendDir {
  if (series.length < 4) return "same";
  const half = Math.floor(series.length / 2);
  const first = series.slice(0, half);
  const second = series.slice(half);
  const firstMean = first.reduce((a, b) => a + b, 0) / first.length;
  const secondMean = second.reduce((a, b) => a + b, 0) / second.length;
  const diff = secondMean - firstMean;
  if (diff > threshold) return "up";
  if (diff < -threshold) return "down";
  return "same";
}

/* --- Velocity (synced sprints) --- */
export function velocityKPIs(sprints: Sprint[]): {
  avgVelocity: number | null;
  predictability: number | null;
  trend: TrendDir;
  series: number[];
} {
  const completed = sprints.filter((s) => s.status === "completed");
  if (completed.length === 0) {
    return { avgVelocity: null, predictability: null, trend: "same", series: [] };
  }
  const series = completed.map((s) => s.pointsCompleted ?? 0);
  const avg = series.reduce((a, b) => a + b, 0) / series.length;
  // Predictability mirrors tool.health_dashboard.get_summary exactly: a sprint
  // is "predictable" when its completed points met or beat the planned points.
  const predictable = completed.filter((s) => (s.pointsCompleted ?? 0) >= s.pointsPlanned).length;
  return {
    avgVelocity: Math.round(avg * 10) / 10,
    predictability: Math.round((predictable / completed.length) * 100),
    trend: halfSplitTrend(series, 1),
    series,
  };
}

/* --- Team Health (synced healthChecks singleton) --- */
function healthPctOf(scores: Record<string, { light: string }>): number | null {
  const list = Object.values(scores ?? {});
  if (list.length === 0) return null;
  const total = list.reduce((sum, s) => sum + (LIGHT_SCORE[s.light] ?? 0), 0);
  return Math.round((total / (list.length * 2)) * 100);
}

export function healthCheckKPIs(healthChecks: HealthCheck[]): {
  healthPct: number | null;
  trend: TrendDir;
  series: number[];
} {
  const hc = healthChecks.find((h) => h.id === HEALTH_CHECK_ID) ?? healthChecks[0];
  const history = hc?.history ?? [];

  // Read SAVED checks, not `current`. The Squad Health Check tool's
  // `saveCheck()` archives the scored snapshot into `history` and resets
  // `current` to a pristine all-green form. Sourcing the headline from
  // `current` therefore reported 100% / "On Track" the instant a user saved
  // an all-red check, pinned the sparkline's last point at 100, and made the
  // trend arrow always point up. `current` is a draft, never a measurement —
  // fall back to it only when nothing has been saved yet.
  const series: number[] = [];
  for (const h of history) {
    const hPct = healthPctOf(h.scores ?? {});
    if (hPct !== null) series.push(hPct);
  }

  let pct: number | null;
  if (series.length > 0) {
    pct = series[series.length - 1];
  } else {
    pct = hc ? healthPctOf(hc.current?.scores ?? {}) : null;
    if (pct !== null) series.push(pct);
  }
  if (pct === null) return { healthPct: null, trend: "same", series: [] };

  // Trend: compare the latest saved check to the one before it (±5pt band).
  // A prior entry at a literal 0% (all-red check) is a valid baseline: the
  // comparison is a subtraction, not a ratio, so no `> 0` guard is needed
  // — that guard suppressed the "up" arrow on exactly the all-red → green
  // recovery it should highlight. Malformed/empty rows are what the guard
  // was defending against, and `healthPctOf` already returns null for
  // those.
  let trend: TrendDir = "same";
  if (series.length > 1) {
    const diff = pct - series[series.length - 2];
    if (diff > 5) trend = "up";
    else if (diff < -5) trend = "down";
  }
  return { healthPct: pct, trend, series };
}

/* --- Impediments (synced impediments collection) --- */
export function impedimentKPIs(impediments: Impediment[]): {
  openCount: number | null;
  criticalCount: number | null;
  avgResolutionDays: number | null;
} {
  if (impediments.length === 0) {
    return { openCount: null, criticalCount: null, avgResolutionDays: null };
  }
  const open = impediments.filter((i) => !i.resolvedAt);
  const critical = open.filter((i) => i.severity === "critical");

  const resolved = impediments.filter((i) => i.resolvedAt && i.raisedAt);
  let avgResolutionDays: number | null = null;
  if (resolved.length > 0) {
    let valid = 0;
    const totalDays = resolved.reduce((sum, i) => {
      const start = new Date(i.raisedAt).getTime();
      const end = new Date(i.resolvedAt as string).getTime();
      if (!Number.isFinite(start) || !Number.isFinite(end)) return sum;
      valid += 1;
      return sum + Math.max(0, (end - start) / (1000 * 60 * 60 * 24));
    }, 0);
    avgResolutionDays = valid > 0 ? Math.round((totalDays / valid) * 10) / 10 : null;
  }

  return { openCount: open.length, criticalCount: critical.length, avgResolutionDays };
}

/* --- Standup (synced standupEntries collection) --- */
export function standupKPIs(
  entries: StandupEntry[],
  teamMemberCount: number
): { openBlockers: number | null; participationRate: number | null } {
  if (entries.length === 0) return { openBlockers: null, participationRate: null };

  const openBlockers = entries.filter((e) => e.blockers?.trim() && !e.blockerResolved).length;

  const today = todayLocalISO();
  const todayMembers = new Set(entries.filter((e) => e.date === today).map((e) => e.member));
  const participationRate =
    teamMemberCount > 0 ? Math.round((todayMembers.size / teamMemberCount) * 100) : null;

  return { openBlockers, participationRate };
}
