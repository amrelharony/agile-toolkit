/**
 * The extras behind "Advanced analysis": a second estimate of the 85%
 * forecast by resampling the velocities (a bootstrap), and a change-point
 * check on the velocity series (CUSUM). Each needs more history than the
 * forecast itself, so each says when it can't run yet.
 */

import { bootstrapQuantile } from "@/lib/analytics/bootstrap";
import { hasRecentChangepoint } from "@/lib/analytics/changepoint";
import { MIN_SAMPLE, enoughData } from "@/lib/analytics/min-sample";

export interface CrossCheck {
  /** Sprints at the slow-sprint (15th percentile) velocity: comparable to the Monte Carlo P85. */
  point: number;
  /** The same with the bootstrap's fast and slow bounds. */
  optimistic: number;
  /**
   * Null when the slow bound is 0: resamples heavy in a 0-point sprint
   * deliver nothing, so there is no upper bound to give. (Dividing by a
   * clamped 0.01 turned that into "scope × 100 sprints".)
   */
  pessimistic: number | null;
}

/**
 * Scope ÷ the 15th-percentile velocity, with the bootstrap's bounds. Null
 * below `MIN_SAMPLE.distribution` velocities, and when the slow tail is 0
 * (a sprint that delivered nothing has no sprint count to divide into).
 */
export function bootstrapCrossCheck(scope: number, samples: readonly number[]): CrossCheck | null {
  if (!(scope > 0) || !enoughData(samples.length, MIN_SAMPLE.distribution)) return null;
  const ci = bootstrapQuantile([...samples], 0.15);
  if (![ci.point, ci.lower, ci.upper].every(Number.isFinite) || ci.point <= 0) return null;
  // A higher velocity bound means fewer sprints, so the bounds swap.
  return {
    point: Math.ceil(scope / ci.point),
    optimistic: Math.ceil(scope / Math.max(ci.upper, ci.point)),
    pessimistic: ci.lower > 0 ? Math.ceil(scope / ci.lower) : null,
  };
}

/**
 * Whether the velocity shifted within the last three sprints, so the
 * sample mixes an old pace with a new one. Null below
 * `MIN_SAMPLE.changePoint` velocities: on fewer, one odd sprint reads as a
 * shift.
 */
export function recentShift(samples: readonly number[]): boolean | null {
  if (!enoughData(samples.length, MIN_SAMPLE.changePoint)) return null;
  return hasRecentChangepoint([...samples], 3);
}
