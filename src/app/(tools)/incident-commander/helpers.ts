/**
 * Incident Commander — duration formatting + MTTR helpers. Pure, NaN/negative
 * guarded. No React.
 */

import type { Incident } from "./types";

export function formatDuration(ms: number): string {
  if (ms < 0) return "—";
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export function mttrHours(i: Incident): number | null {
  // `resolvedAt` survives a re-open (status back to active/mitigated), so
  // the status — not the timestamp — says whether the incident is resolved.
  if (i.status !== "resolved" || !i.resolvedAt) return null;
  const ms = new Date(i.resolvedAt).getTime() - new Date(i.openedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms / 3_600_000;
}

export function nowIso(): string {
  return new Date().toISOString();
}
