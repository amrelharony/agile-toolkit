/**
 * Feature Flag Tracker: the one-sentence answer above the list. How many
 * live flags have outstayed their purpose, why, and which are exempt.
 * Pure.
 *
 *   "2 of 5 live flags are stale: 1 rollout past its removal date and
 *    1 experiment over 60 days. 2 are exempt: 1 kill switch and 1
 *    permission flag."
 */

import type { FeatureFlag, FeatureFlagPurpose } from "@/lib/stores/workspace-types";
import {
  FLAG_PURPOSES,
  TYPICAL_LIFETIME_DAYS,
  flagStaleness,
  flagSummary,
} from "@/lib/flags/model";
import { listAnd } from "@/lib/charts/chart-text";

const NOUN: Record<FeatureFlagPurpose, [string, string]> = {
  rollout: ["rollout", "rollouts"],
  experiment: ["experiment", "experiments"],
  kill_switch: ["kill switch", "kill switches"],
  permission: ["permission flag", "permission flags"],
};

const count = (n: number, p: FeatureFlagPurpose) => `${n} ${NOUN[p][n === 1 ? 0 : 1]}`;

export function flagVerdict(flags: readonly FeatureFlag[], today: string): string {
  if (flags.length === 0) return "No flags tracked yet.";
  const s = flagSummary(flags, today);
  if (s.live === 0) {
    return flags.length === 1
      ? "No live flags: the one flag tracked is retired."
      : `No live flags: all ${flags.length} are retired.`;
  }
  const live = flags.filter((f) => f.status !== "retired");
  const states = live.map((f) => ({ f, st: flagStaleness(f, today) }));

  const exempt = FLAG_PURPOSES.map((p) => ({
    p,
    n: states.filter((x) => x.st.exempt && x.f.purpose === p).length,
  })).filter((x) => x.n > 0);
  const exemptText =
    exempt.length === 0
      ? ""
      : ` ${s.exempt} ${s.exempt === 1 ? "is" : "are"} exempt: ${listAnd(exempt.map((x) => count(x.n, x.p)))}.`;

  if (s.stale === 0) {
    const of = s.live === 1 ? "the one live flag" : `the ${s.live} live flags`;
    return `No stale flags among ${of}.${exemptText}`;
  }

  const parts: string[] = [];
  for (const p of FLAG_PURPOSES) {
    const past = states.filter(
      (x) => x.f.purpose === p && x.st.reason === "past-removal-date"
    ).length;
    if (past > 0) parts.push(`${count(past, p)} past ${past === 1 ? "its" : "their"} removal date`);
  }
  for (const p of FLAG_PURPOSES) {
    const over = states.filter(
      (x) => x.f.purpose === p && x.st.reason === "over-typical-lifetime"
    ).length;
    if (over > 0) parts.push(`${count(over, p)} over ${TYPICAL_LIFETIME_DAYS[p]} days`);
  }
  const head =
    s.stale === s.live
      ? s.live === 1
        ? "The one live flag is stale"
        : `All ${s.live} live flags are stale`
      : `${s.stale} of ${s.live} live flags ${s.stale === 1 ? "is" : "are"} stale`;
  return `${head}: ${listAnd(parts)}.${exemptText}`;
}
