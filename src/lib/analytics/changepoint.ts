import { mean, stdDev } from "./anomaly";

export interface Changepoint {
  index: number;
  direction: "up" | "down";
  /**
   * Cumulative deviation magnitude in σ-units (always positive).
   * Previously this was the raw cumulant — positive for "up" detections
   * (cPos > h) but NEGATIVE for "down" detections (cNeg < -h). Consumers
   * comparing `cumulativeStat >= threshold` silently ignored every
   * down-direction match. Returning the magnitude makes the threshold
   * comparison symmetric.
   */
  cumulativeStat: number;
}

/**
 * CUSUM (Cumulative Sum) changepoint detection. Maintains positive and
 * negative cumulative sums of standardised residuals; signals a changepoint
 * when either crosses h * σ. After a detection the relevant cumulant is
 * reset so subsequent changes can be found.
 *
 * Lightweight, online, parameter-light — well-suited to short series
 * (5-50 points) typical of sprint metrics, where heavier methods (PELT,
 * Bayesian online changepoint) offer marginal gains for noticeable cost.
 *
 * @param series  observations (raw counts, velocities, percentages)
 * @param k       reference value, default 0.5σ — tolerance before counting drift
 * @param h       decision threshold in σ-units, default 4 — trades sensitivity vs false-positive
 */
export function cusum(series: number[], k = 0.5, h = 4): Changepoint[] {
  if (series.length < 4) return [];
  const m = mean(series);
  const s = stdDev(series);
  if (s === 0) return [];

  let cPos = 0;
  let cNeg = 0;
  const out: Changepoint[] = [];
  for (let i = 0; i < series.length; i++) {
    const standardised = (series[i] - m) / s;
    cPos = Math.max(0, cPos + standardised - k);
    cNeg = Math.min(0, cNeg + standardised + k);
    if (cPos > h) {
      out.push({ index: i, direction: "up", cumulativeStat: cPos });
      // R8: only reset the TRIGGERING cumulant. Resetting both biases
      // subsequent detection — Page (1954) / Hawkins & Olwell specify
      // the opposite cumulant must keep accumulating relative to the
      // new baseline. After this fix, a sustained up-trend followed
      // by a sharp down-shift won't need to re-cross the threshold
      // from a forced zero.
      cPos = 0;
    } else if (cNeg < -h) {
      // Report magnitude (always positive) so consumers can compare against
      // a single threshold regardless of direction.
      out.push({ index: i, direction: "down", cumulativeStat: -cNeg });
      cNeg = 0;
    }
  }
  return out;
}

/**
 * Convenience: returns true if a recent changepoint occurred in the last
 * `window` observations. Useful for KPI badges ("regime shift detected").
 */
export function hasRecentChangepoint(series: number[], window = 3): boolean {
  const cps = cusum(series);
  if (cps.length === 0) return false;
  const last = cps[cps.length - 1];
  return last.index >= series.length - window;
}
