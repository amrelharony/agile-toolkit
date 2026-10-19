import type { KeyResult, Okr } from "@/lib/stores/workspace-types";

/** A key result's progress, 0..1. */
export function krProgress(kr: KeyResult): number {
  // Guard against bad data: NaN/Infinity from `current` divided by `target`,
  // negative targets (the UI may allow them via free-form input), and
  // legitimate zero targets. Without these, a single corrupted KR (e.g.,
  // imported from JSON) used to NaN-propagate into the radar chart.
  if (!Number.isFinite(kr.target) || kr.target === 0) return 0;
  if (!Number.isFinite(kr.current)) return 0;
  const pct = kr.current / kr.target;
  if (!Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(1, pct));
}

/** An objective's progress: the mean of its key results', 0..1. */
export function objectiveHealth(okr: Okr): number {
  if (okr.keyResults.length === 0) return 0;
  return okr.keyResults.reduce((a, kr) => a + krProgress(kr), 0) / okr.keyResults.length;
}
