/**
 * Hill Chart's writes, through the workspace store (workspace.hillCharts,
 * the slice Amr's verbs and the next step read). Each change reads the
 * chart fresh, so an Undo or a move that lands after another write never
 * puts back a stale copy. Stamps updatedAt; the store stamps nothing.
 */

import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { HillChart } from "@/lib/stores/workspace-types";
import { readHillChart } from "@/lib/hill-chart/model";

const ws = () => useWorkspaceStore.getState();

/** Every chart as stored. */
export const currentCharts = (): HillChart[] => ws().hillCharts ?? [];

/** One chart as the page reads it, or null when it is gone. */
export function findChart(id: string): HillChart | null {
  const raw = currentCharts().find((c) => c.id === id);
  return raw ? readHillChart(raw) : null;
}

/** Save a chart as given (Undo puts back exactly what it had). */
export function saveChart(chart: HillChart): void {
  ws().upsertHillChart(chart);
}

/** Change a chart with `fn` and stamp it; returns what was saved, or null when it is gone. */
export function patchChart(id: string, fn: (chart: HillChart) => HillChart): HillChart | null {
  const current = findChart(id);
  if (!current) return null;
  const next = fn(current);
  if (next === current) return current;
  const saved = { ...next, updatedAt: new Date().toISOString() };
  saveChart(saved);
  return saved;
}

/** Remove a chart; returns what was removed (for Undo), or null. */
export function removeChart(id: string): HillChart | null {
  const raw = currentCharts().find((c) => c.id === id);
  if (!raw) return null;
  ws().removeHillChart(id);
  return raw;
}
