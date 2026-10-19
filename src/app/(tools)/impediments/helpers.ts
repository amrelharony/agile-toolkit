/**
 * Impediment Tracker — pure date/age + weekly-bucketing helpers. All are
 * NaN-guarded so a single corrupted localStorage row can't poison averages,
 * series, or badges. No React.
 */

import type { Impediment as WorkspaceImpediment } from "@/lib/stores/workspace-types";
import type { Impediment, Severity } from "./types";

const SEVERITY_TO_WORKSPACE: Record<Severity, WorkspaceImpediment["severity"]> = {
  Low: "low",
  Medium: "medium",
  High: "high",
  Critical: "critical",
};

/**
 * The workspace.impediments row for a local impediment: what the one-way
 * bridge in impediments-client writes, and what a hand-off writes alongside
 * the local row (same id), so the bridge finds nothing to change. Keeps
 * where it came from: `source` (default "manual") and `sourceRef`.
 */
export function toWorkspaceImpediment(local: Impediment): WorkspaceImpediment {
  return {
    id: local.id,
    title: local.title,
    severity: SEVERITY_TO_WORKSPACE[local.severity] ?? "medium",
    raisedAt: local.raisedDate,
    resolvedAt: local.resolvedDate,
    owner: local.assignedTo || undefined,
    source: local.source ?? "manual",
    sourceRef: local.sourceRef,
  };
}

/** Whether a workspace row already matches what the bridge would write. */
export function sameWorkspaceImpediment(a: WorkspaceImpediment, b: WorkspaceImpediment): boolean {
  return (
    a.title === b.title &&
    a.severity === b.severity &&
    a.raisedAt === b.raisedAt &&
    a.resolvedAt === b.resolvedAt &&
    a.owner === b.owner &&
    (a.source ?? "manual") === (b.source ?? "manual") &&
    a.sourceRef?.tool === b.sourceRef?.tool &&
    a.sourceRef?.id === b.sourceRef?.id &&
    a.sourceRef?.doc === b.sourceRef?.doc
  );
}

export function daysSince(dateStr: string): number {
  const d = new Date(dateStr).getTime();
  // Guard against `new Date("garbage")` → NaN; without this the badge below
  // displayed "NaNd" for any impediment whose raisedDate got corrupted in
  // localStorage.
  if (!Number.isFinite(d)) return 0;
  const now = Date.now();
  return Math.max(0, Math.floor((now - d) / (1000 * 60 * 60 * 24)));
}

export function avgResolutionDays(impediments: Impediment[]): number {
  const resolved = impediments.filter((i) => i.status === "Resolved" && i.resolvedDate);
  if (resolved.length === 0) return 0;
  let validCount = 0;
  const total = resolved.reduce((sum, i) => {
    const raised = new Date(i.raisedDate).getTime();
    const done = new Date(i.resolvedDate!).getTime();
    // Skip malformed entries so a single bad row doesn't NaN-poison the avg
    // (NaN propagates through addition, then `Math.round(NaN)` → NaN, which
    // surfaced as "NaN days" in the dashboard card).
    if (!Number.isFinite(raised) || !Number.isFinite(done)) return sum;
    validCount += 1;
    return sum + Math.max(0, Math.floor((done - raised) / (1000 * 60 * 60 * 24)));
  }, 0);
  return validCount > 0 ? Math.round(total / validCount) : 0;
}

/** Pull resolution-day durations for resolved impediments, with NaN-guarding. */
export function resolutionDaysSeries(impediments: Impediment[]): number[] {
  return impediments
    .filter((i) => i.status === "Resolved" && i.resolvedDate)
    .map((i) => {
      const raised = new Date(i.raisedDate).getTime();
      const done = new Date(i.resolvedDate!).getTime();
      if (!Number.isFinite(raised) || !Number.isFinite(done)) return NaN;
      return Math.max(0, Math.floor((done - raised) / (1000 * 60 * 60 * 24)));
    })
    .filter((d) => Number.isFinite(d));
}

function parseISODateUTC(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/**
 * Bucket impediments into weekly raised-counts and open-counts. Capped at
 * the most recent 26 weeks (ending at today's week) to keep the trend
 * window meaningful and forecast cost bounded.
 */
export function buildWeeklyImpedimentSeries(impediments: Impediment[]): {
  raisedPerWeek: number[];
  openAtWeek: number[];
} {
  if (impediments.length === 0) return { raisedPerWeek: [], openAtWeek: [] };
  const dates = impediments
    .map((i) => parseISODateUTC(i.raisedDate))
    .filter((d): d is Date => d !== null);
  if (dates.length === 0) return { raisedPerWeek: [], openAtWeek: [] };

  // R5: `Math.min(...arr)` blows the JS arg-count limit (RangeError:
  // Maximum call stack) on lists >~100k. Use reduce so growth doesn't
  // suddenly crash the page.
  const earliestMs = dates.reduce((m, d) => Math.min(m, d.getTime()), Infinity);
  const earliest = new Date(earliestMs);
  const dayOfWeek = earliest.getUTCDay();
  const weekStart = new Date(earliest);
  weekStart.setUTCDate(earliest.getUTCDate() - dayOfWeek);
  weekStart.setUTCHours(0, 0, 0, 0);

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const totalWeeks = Math.max(
    1,
    Math.ceil((today.getTime() - weekStart.getTime()) / (7 * 86_400_000)) + 1
  );
  const cappedWeeks = Math.min(totalWeeks, 26);
  // The cap must keep the MOST RECENT 26 weeks. Anchoring at the earliest
  // event and truncating the loop kept the OLDEST 26 weeks instead — once a
  // tracker was older than half a year, the weekly chart and the trend /
  // changepoint chips silently froze on stale data while newly raised
  // impediments fell outside every bucket. Shift the anchor forward by
  // whole weeks so Sunday alignment is preserved and the window ends at
  // today's week.
  if (totalWeeks > cappedWeeks) {
    weekStart.setUTCDate(weekStart.getUTCDate() + (totalWeeks - cappedWeeks) * 7);
  }

  const raisedPerWeek = new Array(cappedWeeks).fill(0) as number[];
  const openAtWeek = new Array(cappedWeeks).fill(0) as number[];

  for (let w = 0; w < cappedWeeks; w++) {
    const weekStartT = weekStart.getTime() + w * 7 * 86_400_000;
    const weekEndT = weekStartT + 7 * 86_400_000;
    let raised = 0;
    let open = 0;
    for (const i of impediments) {
      const raisedDate = parseISODateUTC(i.raisedDate);
      if (!raisedDate) continue;
      const raisedT = raisedDate.getTime();
      if (raisedT >= weekStartT && raisedT < weekEndT) raised++;
      if (raisedT < weekEndT) {
        const resolvedDate = i.resolvedDate ? parseISODateUTC(i.resolvedDate) : null;
        if (!resolvedDate || resolvedDate.getTime() >= weekEndT) open++;
      }
    }
    raisedPerWeek[w] = raised;
    openAtWeek[w] = open;
  }

  return { raisedPerWeek, openAtWeek };
}
