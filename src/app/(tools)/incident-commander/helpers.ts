/**
 * Incident Commander — duration formatting + MTTR helpers. Pure, NaN/negative
 * guarded. No React.
 */

import type { Incident } from "./types";

export function formatDuration(ms: number): string {
  // Guard NaN as well as negative: a malformed `openedAt`/`resolvedAt`
  // (e.g. from a hand-edited JSON import) yields NaN ms, and `NaN < 0` is
  // false — without this the card rendered the literal "NaNh NaNm".
  // Mirrors the Number.isFinite guard in mttrHours below.
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export function mttrHours(i: Incident): number | null {
  if (!i.resolvedAt) return null;
  const ms = new Date(i.resolvedAt).getTime() - new Date(i.openedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms / 3_600_000;
}

export function nowIso(): string {
  return new Date().toISOString();
}
