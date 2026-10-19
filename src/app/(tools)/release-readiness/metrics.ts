import type { Release } from "@/lib/stores/workspace-types";

export interface OnTimeRate {
  /** % of releases that went out by their planned date, or null if none have shipped. */
  pct: number | null;
  /** Releases that went out: shipped, plus rolled back after shipping. */
  shipped: number;
  onTime: number;
  /** How many of `shipped` were later rolled back. */
  rolledBack: number;
}

/**
 * "% on time" over every release that went out. A rolled-back release still
 * shipped (it keeps its ship date), so it counts — before, it silently fell
 * out of the metric when it was marked rolled back. One rolled back without
 * a ship date (set straight from planning) never went out and isn't counted.
 */
export function onTimeRate(releases: Release[]): OnTimeRate {
  const wentOut = releases.filter(
    (r) => r.status === "shipped" || (r.status === "rolled_back" && !!r.shippedDate)
  );
  const onTime = wentOut.filter((r) => r.shippedDate && r.shippedDate <= r.plannedDate).length;
  return {
    pct: wentOut.length === 0 ? null : (onTime / wentOut.length) * 100,
    shipped: wentOut.length,
    onTime,
    rolledBack: wentOut.filter((r) => r.status === "rolled_back").length,
  };
}
