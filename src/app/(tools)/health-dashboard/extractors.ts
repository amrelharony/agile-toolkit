/**
 * Health Dashboard — per-tool localStorage extractors.
 *
 * Each `extract*KPIs` reads one tool's persisted zustand blob and derives the
 * dashboard's headline numbers, heavily NaN-guarding against corrupted or
 * schema-drifted rows. NOTE: some of these read pre-migration localStorage
 * keys and may be partly stale now that several tools persist to the synced
 * workspace store — the agent-facing surface
 * (src/lib/actions/tools/health-dashboard.ts) reads the synced entities
 * instead. This UI extractor path is intentionally left unchanged here.
 */

import { todayLocalISO } from "@/lib/utils/formatters";
import type { TrendDir } from "./types";

function readStore<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // zustand persist wraps state in { state: {...}, version: N }
    const result = parsed?.state ?? parsed;
    // R9: previously cast to `T` unconditionally. If `parsed.state` is
    // null (legit zustand-persist shape on first write, or a bad blob),
    // the cast lies and every downstream `data.foo` crashes. Return
    // null instead so callers get the obvious "no data yet" branch.
    if (result === null || typeof result !== "object") return null;
    return result as T;
  } catch {
    return null;
  }
}

/* --- Velocity --- */
interface VelocitySprint {
  id: string;
  committed: number;
  completed: number;
}

export function extractVelocityKPIs(): {
  avgVelocity: number | null;
  predictability: number | null;
  trend: TrendDir;
  /** Raw completed-points series, ascending by sprint, used by Mann-Kendall. */
  series: number[];
} {
  const data = readStore<{ sprints: VelocitySprint[] }>("agile-toolkit:velocity");
  if (!data?.sprints?.length)
    return { avgVelocity: null, predictability: null, trend: "same", series: [] };

  const sprints = data.sprints;
  const completed = sprints.map((s) => s.completed);
  const avg = completed.reduce((a, b) => a + b, 0) / completed.length;
  const predictable = sprints.filter((s) => s.completed >= s.committed).length;
  const predictability = (predictable / sprints.length) * 100;

  let trend: TrendDir = "same";
  if (completed.length >= 4) {
    // Split into halves; on odd lengths put the middle sample into the
    // SECOND half so no data point is dropped. Prior implementation
    // sliced (0, half) + slice(-half), discarding the middle on odd N.
    const half = Math.floor(completed.length / 2);
    const firstSlice = completed.slice(0, half);
    const secondSlice = completed.slice(half);
    const firstHalf = firstSlice.reduce((a, b) => a + b, 0) / firstSlice.length;
    const secondHalf = secondSlice.reduce((a, b) => a + b, 0) / secondSlice.length;
    const diff = secondHalf - firstHalf;
    if (diff > 1) trend = "up";
    else if (diff < -1) trend = "down";
  }

  return {
    avgVelocity: Math.round(avg * 10) / 10,
    predictability: Math.round(predictability),
    trend,
    series: completed,
  };
}

/* --- Health Check --- */
type HealthLight = "green" | "yellow" | "red";
type HealthTrend = "up" | "same" | "down";

interface HealthDimensionScore {
  light: HealthLight;
  trend: HealthTrend;
}

interface HealthCheckHistoryEntry {
  id: string;
  sprintName: string;
  date: string;
  scores: Record<string, HealthDimensionScore>;
}

export function extractHealthCheckKPIs(): {
  healthPct: number | null;
  trend: TrendDir;
  /** Historical scores ascending by date — used by Mann-Kendall. */
  series: number[];
} {
  const data = readStore<{
    current: { scores: Record<string, HealthDimensionScore> };
    history: HealthCheckHistoryEntry[];
  }>("agile-toolkit:health-check");

  if (!data?.current?.scores) return { healthPct: null, trend: "same", series: [] };

  const scoreMap: Record<HealthLight, number> = { green: 2, yellow: 1, red: 0 };
  // Coerce malformed `light` values (e.g. a renamed enum from an older build)
  // to 0 instead of letting `scoreMap[undefined]` propagate as NaN through
  // the sum — that produced `pct = NaN` and broke the entire dashboard card.
  const lookup = (s: { light: unknown }): number =>
    typeof s.light === "string" && s.light in scoreMap ? scoreMap[s.light as HealthLight] : 0;
  const scores = Object.values(data.current.scores);
  if (scores.length === 0) return { healthPct: null, trend: "same", series: [] };

  const total = scores.reduce((sum, s) => sum + lookup(s), 0);
  const maxTotal = scores.length * 2;
  const pct = maxTotal > 0 ? Math.round((total / maxTotal) * 100) : 0;

  // Trend: compare current to last history entry
  let trend: TrendDir = "same";
  const history = data.history ?? [];
  const series: number[] = [];
  if (history.length > 0) {
    for (const h of history) {
      const hScores = Object.values(h.scores ?? {});
      if (hScores.length === 0) continue;
      const hTotal = hScores.reduce((sum, s) => sum + lookup(s), 0);
      const hMax = hScores.length * 2;
      // hMax is non-zero here because we just gated on `length === 0`, but
      // belt-and-braces: NaN-poisoning into the series would silently break
      // the Mann-Kendall trend chip without a visible error message.
      series.push(hMax > 0 ? Math.round((hTotal / hMax) * 100) : 0);
    }
    series.push(pct);

    const last = history[history.length - 1];
    const lastScores = Object.values(last.scores ?? {});
    if (lastScores.length > 0) {
      const lastTotal = lastScores.reduce((sum, s) => sum + lookup(s), 0);
      const lastMax = lastScores.length * 2;
      // Guard against a fully-malformed last entry (every `light`
      // unrecognised → lookup returns 0 → lastTotal = 0 → lastPct = 0).
      // Without this, a current pct > 0 produced a spurious "up" trend
      // arrow whenever the prior history row had a broken schema.
      if (lastTotal > 0 && lastMax > 0) {
        const lastPct = (lastTotal / lastMax) * 100;
        const diff = pct - lastPct;
        if (diff > 5) trend = "up";
        else if (diff < -5) trend = "down";
      }
    }
  }

  return { healthPct: pct, trend, series };
}

/* --- Impediments --- */
interface Impediment {
  id: string;
  severity: string;
  status: string;
  raisedDate: string;
  resolvedDate?: string;
}

export function extractImpedimentKPIs(): {
  openCount: number | null;
  criticalCount: number | null;
  avgResolutionDays: number | null;
} {
  const data = readStore<{ impediments: Impediment[] }>("agile-toolkit:impediments");
  if (!data?.impediments) return { openCount: null, criticalCount: null, avgResolutionDays: null };

  const imps = data.impediments;
  const open = imps.filter((i) => i.status !== "Resolved");
  const critical = open.filter((i) => i.severity === "Critical");

  const resolved = imps.filter((i) => i.status === "Resolved" && i.resolvedDate && i.raisedDate);
  let avgDays: number | null = null;
  if (resolved.length > 0) {
    let validCount = 0;
    const totalDays = resolved.reduce((sum, i) => {
      const start = new Date(i.raisedDate).getTime();
      const end = new Date(i.resolvedDate!).getTime();
      // Guard against `new Date("garbage")` → NaN, which would otherwise
      // produce NaN avgDays for the dashboard card.
      if (!Number.isFinite(start) || !Number.isFinite(end)) return sum;
      validCount += 1;
      return sum + Math.max(0, (end - start) / (1000 * 60 * 60 * 24));
    }, 0);
    avgDays = validCount > 0 ? Math.round((totalDays / validCount) * 10) / 10 : null;
  }

  return {
    openCount: open.length,
    criticalCount: critical.length,
    avgResolutionDays: avgDays,
  };
}

/* --- Standup --- */
interface StandupEntry {
  id: string;
  member: string;
  date: string;
  blockers: string;
  timestamp: number;
}

export function extractStandupKPIs(): {
  openBlockers: number | null;
  participationRate: number | null;
} {
  const data = readStore<{
    members: string[];
    entries: StandupEntry[];
    resolvedBlockers: string[];
  }>("agile-toolkit:standup");

  if (!data?.entries) return { openBlockers: null, participationRate: null };

  const today = todayLocalISO();
  const allEntries = data.entries;
  const resolvedBlockers = data.resolvedBlockers ?? [];

  const entriesWithBlockers = allEntries.filter(
    (e) => e.blockers?.trim() && !resolvedBlockers.includes(e.id)
  );
  const openBlockers = entriesWithBlockers.length;

  // Participation: today's entries vs total members
  const members = data.members ?? [];
  const todayEntries = allEntries.filter((e) => e.date === today);
  const participationRate =
    members.length > 0 ? Math.round((todayEntries.length / members.length) * 100) : null;

  return { openBlockers, participationRate };
}

/* --- Cycle Time --- */
interface WorkItem {
  id: string;
  startDate: string;
  endDate: string;
}

export function extractCycleTimeKPIs(): { p85: number | null } {
  const data = readStore<{ items: WorkItem[] }>("agile-toolkit:cycle-time");
  if (!data?.items?.length) return { p85: null };

  const cycleTimes: number[] = data.items
    .map((item) => {
      if (!item.startDate || !item.endDate) return null;
      const s = new Date(item.startDate).getTime();
      const e = new Date(item.endDate).getTime();
      // Use Number.isFinite so both NaN and ±Infinity are excluded (the
      // latter can happen when a hand-edited payload contains JSON values
      // like `Infinity` re-parsed from a stringified form).
      if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return null;
      return Math.round((e - s) / (1000 * 60 * 60 * 24));
    })
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);

  if (cycleTimes.length === 0) return { p85: null };

  const idx = Math.ceil((cycleTimes.length * 85) / 100) - 1;
  const p85 = cycleTimes[Math.max(0, Math.min(idx, cycleTimes.length - 1))];

  return { p85 };
}
