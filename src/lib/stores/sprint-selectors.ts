/**
 * Pure sprint selectors over the workspace. They live outside
 * workspace-store.ts so pure modules (the Sprint Metrics wording, tests) can
 * use them without loading the store, which starts the sync registry with a
 * fire-and-forget import when it loads in a browser. workspace-store.ts
 * re-exports both, so existing imports keep working.
 */

import type { Sprint } from "./workspace-types";

/** Anything with the workspace's sprints, the Workspace itself included. */
type WithSprints = { readonly sprints: readonly Sprint[] };

export function selectActiveSprint(w: WithSprints): Sprint | undefined {
  // If multiple sprints are marked active (invariant violation), prefer the
  // one with the most recent start date so the UI surfaces the most
  // contextually-relevant sprint rather than the first by array order.
  const active = w.sprints.filter((s) => s.status === "active");
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  return active.slice().sort((a, b) => parseDateSafe(b.startDate) - parseDateSafe(a.startDate))[0];
}

function parseDateSafe(iso: string | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

export function selectCompletedSprints(w: WithSprints): Sprint[] {
  // Cache the parsed timestamp once per sprint so the sort comparator runs
  // O(n log n) Date constructions instead of O(n log n × 2). Invalid dates
  // sort to the front (timestamp 0) so they're visible to the user rather
  // than silently dropping into an unstable middle.
  return w.sprints
    .filter((s) => s.status === "completed" && typeof s.pointsCompleted === "number")
    .map((s) => [s, parseDateSafe(s.startDate)] as const)
    .sort((a, b) => a[1] - b[1])
    .map(([s]) => s);
}
